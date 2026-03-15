/**
 * TCP forwarder — opens a local TCP connection to the target service and
 * bridges data bidirectionally through the tunnel WebSocket frames.
 *
 * Protocol (mirrors server-side TunnelBroker):
 *   4-byte header:
 *     byte 0  : message type  (OPEN=1, DATA=2, CLOSE=3, PING=4, PONG=5)
 *     byte 1  : flags         (reserved, 0)
 *     bytes 2-3 : streamId   (uint16 big-endian)
 *   + variable-length payload
 */

import net from 'net';
import type WebSocket from 'ws';
import { MsgType, buildFrame, HEADER_SIZE } from './protocol';

const log = (msg: string) => process.stdout.write(`[tunnel-agent] ${msg}\n`);
const warn = (msg: string) => process.stderr.write(`[tunnel-agent] WARN ${msg}\n`);

/** Active local TCP sockets keyed by streamId */
const activeSockets = new Map<number, net.Socket>();

/**
 * Handle an incoming OPEN frame from the server.
 * Parses the "host:port" payload, opens a local TCP connection,
 * and sends back an OPEN ack frame.
 */
export function handleOpenFrame(
  ws: WebSocket,
  streamId: number,
  payload: Buffer,
): void {
  const target = payload.toString('utf8');
  const lastColon = target.lastIndexOf(':');
  if (lastColon === -1) {
    warn(`OPEN frame for stream ${streamId} has invalid target: "${target}"`);
    ws.send(buildFrame(MsgType.CLOSE, streamId));
    return;
  }

  const host = target.slice(0, lastColon);
  const port = parseInt(target.slice(lastColon + 1), 10);

  if (isNaN(port) || port < 1 || port > 65535) {
    warn(`OPEN frame for stream ${streamId} has invalid port: "${target}"`);
    ws.send(buildFrame(MsgType.CLOSE, streamId));
    return;
  }

  // Security: only allow connections to localhost targets (prevent SSRF)
  const ALLOWED_HOSTS = ['localhost', '127.0.0.1', '::1'];
  if (!ALLOWED_HOSTS.includes(host)) {
    warn(`OPEN frame for stream ${streamId} rejected: non-localhost host "${host}" is not allowed`);
    ws.send(buildFrame(MsgType.CLOSE, streamId));
    return;
  }

  log(`Opening local TCP connection to ${host}:${port} for stream ${streamId}`);

  const socket = net.connect(port, host);

  socket.on('connect', () => {
    activeSockets.set(streamId, socket);
    // Acknowledge the OPEN to the server
    ws.send(buildFrame(MsgType.OPEN, streamId));
    log(`Stream ${streamId} connected to ${host}:${port}`);
  });

  socket.on('data', (chunk: Buffer) => {
    if (ws.readyState !== 1 /* OPEN */) {
      socket.destroy();
      return;
    }
    ws.send(buildFrame(MsgType.DATA, streamId, chunk));
  });

  socket.on('close', () => {
    if (activeSockets.has(streamId)) {
      activeSockets.delete(streamId);
      if (ws.readyState === 1 /* OPEN */) {
        ws.send(buildFrame(MsgType.CLOSE, streamId));
      }
    }
  });

  socket.on('error', (err) => {
    warn(`TCP socket error for stream ${streamId}: ${err.message}`);
    activeSockets.delete(streamId);
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(buildFrame(MsgType.CLOSE, streamId));
    }
    if (!socket.destroyed) socket.destroy();
  });
}

/**
 * Handle an incoming DATA frame from the server: write to the local socket.
 */
export function handleDataFrame(streamId: number, payload: Buffer): void {
  const socket = activeSockets.get(streamId);
  if (!socket) {
    warn(`DATA frame for unknown stream ${streamId} — ignoring`);
    return;
  }
  socket.write(payload);
}

/**
 * Handle an incoming CLOSE frame from the server: destroy the local socket.
 */
export function handleCloseFrame(ws: WebSocket, streamId: number): void {
  const socket = activeSockets.get(streamId);
  if (socket) {
    activeSockets.delete(streamId);
    if (!socket.destroyed) socket.destroy();
  }
}

/**
 * Destroy all active sockets (called on tunnel disconnect).
 */
export function destroyAllSockets(): void {
  for (const [streamId, socket] of activeSockets.entries()) {
    activeSockets.delete(streamId);
    if (!socket.destroyed) socket.destroy();
  }
}

/**
 * Return the number of currently active TCP streams.
 */
export function activeStreamCount(): number {
  return activeSockets.size;
}

// Re-export protocol helpers so callers only need this module
export { HEADER_SIZE, MsgType, buildFrame };
