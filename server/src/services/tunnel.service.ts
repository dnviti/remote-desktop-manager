/**
 * TunnelBroker — zero-trust WSS tunnel service.
 *
 * Manages a registry of connected tunnel agents (Map<gatewayId, TunnelConnection>),
 * multiplexes TCP streams over a binary-framed WebSocket, and provides an
 * openStream() API that returns a net.Duplex-compatible stream for transparent
 * use by SSH2 / guacamole-lite.
 *
 * Wire protocol (binary frames):
 *   4-byte header:
 *     byte 0 : message type  (OPEN=1, DATA=2, CLOSE=3, PING=4, PONG=5)
 *     byte 1 : flags         (reserved, set to 0)
 *     bytes 2-3 : streamId   (uint16 big-endian)
 *   followed by payload (variable length, 0 bytes for OPEN/CLOSE/PING/PONG)
 */

import crypto from 'crypto';
import net from 'net';
import { Duplex } from 'stream';
import type WebSocket from 'ws';
import prisma from '../lib/prisma';
import { encryptWithServerKey, hashToken } from './crypto.service';
import { logger } from '../utils/logger';
import * as auditService from './audit.service';

const log = logger.child('tunnel');

// ---------------------------------------------------------------------------
// Protocol constants
// ---------------------------------------------------------------------------

export const MsgType = {
  OPEN:  1,
  DATA:  2,
  CLOSE: 3,
  PING:  4,
  PONG:  5,
} as const;

export type MsgTypeValue = typeof MsgType[keyof typeof MsgType];

const HEADER_SIZE = 4;
const MAX_STREAM_ID = 0xffff;
const MAX_FRAME_SIZE = 1_048_576; // 1 MB
const HEARTBEAT_DB_INTERVAL_MS = 30_000; // Throttle heartbeat DB writes to once per 30s

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingOpen {
  resolve: (stream: Duplex) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Represents a single active tunnel WebSocket connection from a gateway agent. */
export interface TunnelConnection {
  gatewayId: string;
  ws: WebSocket;
  connectedAt: Date;
  clientVersion?: string;
  clientIp?: string;
  /** Map from streamId → Duplex stream for open multiplexed channels */
  streams: Map<number, Duplex>;
  /** Pending openStream() calls waiting for the remote OPEN acknowledgement */
  pendingOpens: Map<number, PendingOpen>;
  nextStreamId: number;
  /** Timestamp of last heartbeat persisted to DB (for throttling) */
  lastHeartbeatDbWrite: number;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** Global registry: gatewayId → TunnelConnection */
const registry = new Map<string, TunnelConnection>();

export function getRegisteredTunnels(): string[] {
  return Array.from(registry.keys());
}

export function isTunnelConnected(gatewayId: string): boolean {
  const conn = registry.get(gatewayId);
  if (!conn) return false;
  // Check that the underlying WS is still open
  return conn.ws.readyState === 1 /* OPEN */;
}

// ---------------------------------------------------------------------------
// Registration / deregistration
// ---------------------------------------------------------------------------

/**
 * Register a newly authenticated tunnel WebSocket for a specific gateway.
 * Called by the tunnel WebSocket handler after authentication succeeds.
 */
export function registerTunnel(
  gatewayId: string,
  ws: WebSocket,
  clientVersion?: string,
  clientIp?: string,
): TunnelConnection {
  // Evict any stale connection for the same gateway
  const existing = registry.get(gatewayId);
  if (existing) {
    log.warn(`[tunnel] Gateway ${gatewayId} reconnected — closing previous connection`);
    try { existing.ws.close(1001, 'replaced'); } catch { /* ignore */ }
    evictConnection(existing);
  }

  const conn: TunnelConnection = {
    gatewayId,
    ws,
    connectedAt: new Date(),
    clientVersion,
    clientIp,
    streams: new Map(),
    pendingOpens: new Map(),
    nextStreamId: 1,
    lastHeartbeatDbWrite: 0,
  };

  registry.set(gatewayId, conn);
  attachFrameHandler(conn);
  log.info(`[tunnel] Gateway ${gatewayId} connected (ip=${clientIp ?? 'unknown'}, version=${clientVersion ?? 'unknown'})`);

  // Persist connection metadata
  prisma.gateway.update({
    where: { id: gatewayId },
    data: {
      tunnelConnectedAt: conn.connectedAt,
      tunnelLastHeartbeat: conn.connectedAt,
      tunnelClientVersion: clientVersion ?? null,
      tunnelClientIp: clientIp ?? null,
    },
  }).catch((err: unknown) => {
    log.warn(`[tunnel] Failed to persist connection state for gateway ${gatewayId}: ${(err as Error).message}`);
  });

  auditService.log({
    action: 'TUNNEL_CONNECT',
    targetType: 'Gateway',
    targetId: gatewayId,
    details: { clientVersion, clientIp },
    ipAddress: clientIp,
  });

  return conn;
}

export function deregisterTunnel(gatewayId: string): void {
  const conn = registry.get(gatewayId);
  if (!conn) return;

  evictConnection(conn);
  log.info(`[tunnel] Gateway ${gatewayId} disconnected`);

  prisma.gateway.update({
    where: { id: gatewayId },
    data: { tunnelConnectedAt: null, tunnelLastHeartbeat: null },
  }).catch((err: unknown) => {
    log.warn(`[tunnel] Failed to clear connection state for gateway ${gatewayId}: ${(err as Error).message}`);
  });

  auditService.log({
    action: 'TUNNEL_DISCONNECT',
    targetType: 'Gateway',
    targetId: gatewayId,
  });
}

function evictConnection(conn: TunnelConnection): void {
  registry.delete(conn.gatewayId);
  // Destroy all open streams
  for (const stream of conn.streams.values()) {
    if (!stream.destroyed) stream.destroy(new Error('tunnel closed'));
  }
  conn.streams.clear();
  // Reject all pending opens
  for (const pending of conn.pendingOpens.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error('tunnel closed'));
  }
  conn.pendingOpens.clear();
}

// ---------------------------------------------------------------------------
// openStream — public API for SSH2 / guacamole-lite
// ---------------------------------------------------------------------------

/**
 * Open a new multiplexed TCP stream through the tunnel to `host:port`.
 * Returns a net.Duplex-compatible stream once the remote agent acknowledges.
 *
 * @param gatewayId - The gateway that owns the tunnel.
 * @param host      - The target host (from the gateway's perspective).
 * @param port      - The target TCP port.
 * @param timeoutMs - How long to wait for the remote OPEN ack (default 10 s).
 */
export function openStream(
  gatewayId: string,
  host: string,
  port: number,
  timeoutMs = 10_000,
): Promise<Duplex> {
  // Validate host to prevent SSRF
  const BLOCKED_HOSTS = ['169.254.169.254', '0.0.0.0'];
  if (!host || BLOCKED_HOSTS.includes(host)) {
    return Promise.reject(new Error(`Blocked host: ${host}`));
  }
  // Validate port is a valid integer in TCP range
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return Promise.reject(new Error(`Invalid port: ${port}`));
  }

  const conn = registry.get(gatewayId);
  if (!conn || conn.ws.readyState !== 1 /* OPEN */) {
    return Promise.reject(new Error(`No active tunnel for gateway ${gatewayId}`));
  }

  return new Promise<Duplex>((resolve, reject) => {
    // Allocate a stream ID, wrapping around if needed
    let streamId = conn.nextStreamId;
    let attempts = 0;
    while (conn.streams.has(streamId) || conn.pendingOpens.has(streamId)) {
      streamId = (streamId % MAX_STREAM_ID) + 1;
      if (++attempts > MAX_STREAM_ID) {
        reject(new Error('No available stream IDs'));
        return;
      }
    }
    conn.nextStreamId = (streamId % MAX_STREAM_ID) + 1;

    // Set up timeout
    const timer = setTimeout(() => {
      conn.pendingOpens.delete(streamId);
      reject(new Error(`openStream timeout for gateway ${gatewayId} → ${host}:${port}`));
    }, timeoutMs);

    conn.pendingOpens.set(streamId, { resolve, reject, timer });

    // Send OPEN frame: header + "host:port" as UTF-8 payload
    const payload = Buffer.from(`${host}:${port}`, 'utf8');
    const frame = buildFrame(MsgType.OPEN, streamId, payload);
    conn.ws.send(frame, (err) => {
      if (err) {
        clearTimeout(timer);
        conn.pendingOpens.delete(streamId);
        reject(err);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Frame handling
// ---------------------------------------------------------------------------

function buildFrame(type: MsgTypeValue, streamId: number, payload?: Buffer): Buffer {
  const body = payload ?? Buffer.alloc(0);
  const frame = Buffer.allocUnsafe(HEADER_SIZE + body.length);
  frame[0] = type;
  frame[1] = 0; // flags
  frame.writeUInt16BE(streamId, 2);
  body.copy(frame, HEADER_SIZE);
  return frame;
}

function attachFrameHandler(conn: TunnelConnection): void {
  conn.ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
    const buf = Buffer.isBuffer(data)
      ? data
      : Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.from(data as ArrayBuffer);

    if (buf.length < HEADER_SIZE) {
      log.warn(`[tunnel] ${conn.gatewayId}: frame too short (${buf.length} bytes)`);
      return;
    }

    if (buf.length > MAX_FRAME_SIZE) {
      log.warn(`[tunnel] ${conn.gatewayId}: frame exceeds max size (${buf.length} bytes > ${MAX_FRAME_SIZE}), closing connection`);
      conn.ws.close(1009, 'frame too large');
      return;
    }

    const type = buf[0] as MsgTypeValue;
    const streamId = buf.readUInt16BE(2);
    const payload = buf.slice(HEADER_SIZE);

    switch (type) {
      case MsgType.OPEN:
        handleOpenAck(conn, streamId);
        break;
      case MsgType.DATA:
        handleData(conn, streamId, payload);
        break;
      case MsgType.CLOSE:
        handleClose(conn, streamId);
        break;
      case MsgType.PING:
        handlePing(conn, streamId);
        break;
      case MsgType.PONG:
        handlePong(conn);
        break;
      default:
        log.warn(`[tunnel] ${conn.gatewayId}: unknown message type ${type}`);
    }
  });

  conn.ws.on('close', () => {
    deregisterTunnel(conn.gatewayId);
  });

  conn.ws.on('error', (err) => {
    log.error(`[tunnel] ${conn.gatewayId} WebSocket error: ${err.message}`);
    deregisterTunnel(conn.gatewayId);
  });
}

function handleOpenAck(conn: TunnelConnection, streamId: number): void {
  const pending = conn.pendingOpens.get(streamId);
  if (!pending) {
    log.warn(`[tunnel] ${conn.gatewayId}: unexpected OPEN ack for stream ${streamId}`);
    return;
  }
  clearTimeout(pending.timer);
  conn.pendingOpens.delete(streamId);

  const stream = createStream(conn, streamId);
  conn.streams.set(streamId, stream);
  pending.resolve(stream);
}

function handleData(conn: TunnelConnection, streamId: number, payload: Buffer): void {
  const stream = conn.streams.get(streamId);
  if (!stream) {
    log.warn(`[tunnel] ${conn.gatewayId}: DATA for unknown stream ${streamId}`);
    return;
  }
  if (!stream.push(payload)) {
    // Back-pressure: pause upstream until stream is drained
    // (the stream will resume via 'drain' event on the Duplex)
  }
}

function handleClose(conn: TunnelConnection, streamId: number): void {
  const stream = conn.streams.get(streamId);
  if (stream && !stream.destroyed) {
    stream.push(null); // signal EOF
    stream.destroy();
  }
  conn.streams.delete(streamId);
}

function handlePing(conn: TunnelConnection, streamId: number): void {
  const frame = buildFrame(MsgType.PONG, streamId);
  conn.ws.send(frame, (err) => {
    if (err) log.warn(`[tunnel] ${conn.gatewayId}: failed to send PONG: ${err.message}`);
  });
}

function handlePong(conn: TunnelConnection): void {
  // Throttle heartbeat DB writes to avoid excessive queries
  const now = Date.now();
  if (now - conn.lastHeartbeatDbWrite < HEARTBEAT_DB_INTERVAL_MS) return;
  conn.lastHeartbeatDbWrite = now;

  prisma.gateway.update({
    where: { id: conn.gatewayId },
    data: { tunnelLastHeartbeat: new Date(now) },
  }).catch(() => { /* best-effort */ });
}

// ---------------------------------------------------------------------------
// Duplex stream factory
// ---------------------------------------------------------------------------

function createStream(conn: TunnelConnection, streamId: number): Duplex {
  const stream = new Duplex({
    read() {
      // Readable side is push-driven by handleData()
    },
    write(chunk: Buffer, _encoding, callback) {
      if (conn.ws.readyState !== 1 /* OPEN */) {
        callback(new Error('tunnel WebSocket is closed'));
        return;
      }
      const frame = buildFrame(MsgType.DATA, streamId, chunk);
      conn.ws.send(frame, (err) => callback(err ?? null));
    },
    destroy(err, callback) {
      if (conn.streams.has(streamId)) {
        conn.streams.delete(streamId);
        const frame = buildFrame(MsgType.CLOSE, streamId);
        try { conn.ws.send(frame); } catch { /* ignore */ }
      }
      callback(err ?? null);
    },
  });

  stream.once('close', () => {
    conn.streams.delete(streamId);
  });

  return stream;
}

// ---------------------------------------------------------------------------
// Token / certificate management
// ---------------------------------------------------------------------------

/** Generate a 256-bit token, store it encrypted + hashed in the DB, return plain token. */
export async function generateTunnelToken(
  gatewayId: string,
  operatorUserId?: string,
): Promise<{ token: string; tunnelEnabled: boolean }> {
  const raw = crypto.randomBytes(32).toString('hex'); // 64 hex chars
  const hash = hashToken(raw);
  const enc = encryptWithServerKey(raw);

  await prisma.gateway.update({
    where: { id: gatewayId },
    data: {
      tunnelEnabled: true,
      encryptedTunnelToken: enc.ciphertext,
      tunnelTokenIV: enc.iv,
      tunnelTokenTag: enc.tag,
      tunnelTokenHash: hash,
    },
  });

  log.info(`[tunnel] Token generated for gateway ${gatewayId} by user ${operatorUserId ?? 'system'}`);

  auditService.log({
    userId: operatorUserId ?? null,
    action: 'TUNNEL_TOKEN_GENERATE',
    targetType: 'Gateway',
    targetId: gatewayId,
  });

  return { token: raw, tunnelEnabled: true };
}

/** Revoke (delete) the tunnel token for a gateway and disable tunnelling. */
export async function revokeTunnelToken(
  gatewayId: string,
  operatorUserId?: string,
): Promise<void> {
  await prisma.gateway.update({
    where: { id: gatewayId },
    data: {
      tunnelEnabled: false,
      encryptedTunnelToken: null,
      tunnelTokenIV: null,
      tunnelTokenTag: null,
      tunnelTokenHash: null,
    },
  });

  // Disconnect active tunnel if any
  deregisterTunnel(gatewayId);

  log.info(`[tunnel] Token revoked for gateway ${gatewayId} by user ${operatorUserId ?? 'system'}`);

  auditService.log({
    userId: operatorUserId ?? null,
    action: 'TUNNEL_TOKEN_ROTATE',
    targetType: 'Gateway',
    targetId: gatewayId,
    details: { revoked: true },
  });
}

/**
 * Authenticate an incoming tunnel WebSocket connection.
 * Returns the gateway record if authentication succeeds, null otherwise.
 *
 * The agent presents:
 *   Authorization: Bearer <token>
 *   X-Gateway-Id:  <uuid>
 *   X-Agent-Version: <version string>   (optional)
 */
export async function authenticateTunnelRequest(
  gatewayId: string,
  bearerToken: string,
): Promise<{ id: string; tenantId: string } | null> {
  if (!gatewayId || !bearerToken) return null;
  if (bearerToken.length > 128) return null; // Reject obviously oversized tokens early

  const gateway = await prisma.gateway.findUnique({
    where: { id: gatewayId },
    select: {
      id: true,
      tenantId: true,
      tunnelEnabled: true,
      encryptedTunnelToken: true,
      tunnelTokenIV: true,
      tunnelTokenTag: true,
      tunnelTokenHash: true,
    },
  });

  if (!gateway || !gateway.tunnelEnabled) return null;
  if (!gateway.tunnelTokenHash) return null;

  // Constant-time comparison against the stored hash
  const incomingHash = hashToken(bearerToken);
  const storedHashBuf = Buffer.from(gateway.tunnelTokenHash, 'hex');
  const incomingHashBuf = Buffer.from(incomingHash, 'hex');

  if (
    storedHashBuf.length !== incomingHashBuf.length ||
    !crypto.timingSafeEqual(storedHashBuf, incomingHashBuf)
  ) {
    return null;
  }

  return { id: gateway.id, tenantId: gateway.tenantId };
}

// ---------------------------------------------------------------------------
// TCP proxy — create a local TCP server that proxies to a gateway via tunnel
// ---------------------------------------------------------------------------

/**
 * Create a local TCP server that forwards every connection through the
 * zero-trust tunnel to `targetHost:targetPort` on the gateway side.
 *
 * Returns the local server and the assigned port.
 * Used to provide a `host:port` tuple to guacamole-lite for GUACD tunnels.
 */
export function createTcpProxy(
  gatewayId: string,
  targetHost: string,
  targetPort: number,
): Promise<{ server: net.Server; localPort: number }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer(async (socket) => {
      try {
        const remote = await openStream(gatewayId, targetHost, targetPort);
        socket.pipe(remote);
        remote.pipe(socket);

        const cleanup = () => {
          socket.destroy();
          remote.destroy();
        };
        socket.once('close', cleanup);
        remote.once('close', cleanup);
        socket.once('error', cleanup);
        remote.once('error', cleanup);
      } catch (err) {
        log.error(`[tunnel] TCP proxy: failed to open stream for gateway ${gatewayId}: ${(err as Error).message}`);
        socket.destroy();
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('Failed to determine TCP proxy port'));
        return;
      }
      resolve({ server, localPort: addr.port });
    });

    server.on('error', reject);
  });
}
