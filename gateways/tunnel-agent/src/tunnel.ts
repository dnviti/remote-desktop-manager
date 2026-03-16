/**
 * TunnelAgent — manages the outbound WSS connection to the TunnelBroker server.
 *
 * Features:
 * - Persistent connection with exponential-backoff reconnection
 * - 15 s ping/pong heartbeat
 * - Binary frame multiplexing (OPEN/DATA/CLOSE/PING/PONG)
 * - Local health reporting in heartbeat metadata
 * - Graceful shutdown on SIGTERM / SIGINT
 */

import WebSocket from 'ws';
import net from 'net';
import type { TunnelConfig } from './config';
import { buildWsOptions } from './auth';
import {
  MsgType,
  buildFrame,
  parseFrame,
  HEADER_SIZE,
} from './protocol';
import {
  handleOpenFrame,
  handleDataFrame,
  handleCloseFrame,
  destroyAllSockets,
  activeStreamCount,
} from './tcpForwarder';

// Silence unused import warning — HEADER_SIZE is exported for downstream use
void HEADER_SIZE;

const log  = (msg: string) => process.stdout.write(`[tunnel-agent] ${msg}\n`);
const warn = (msg: string) => process.stderr.write(`[tunnel-agent] WARN ${msg}\n`);
const err  = (msg: string) => process.stderr.write(`[tunnel-agent] ERROR ${msg}\n`);

/** Result from a local service health probe. */
interface HealthStatus {
  healthy: boolean;
  latencyMs: number;
  activeStreams: number;
}

export class TunnelAgent {
  private cfg: TunnelConfig;
  private ws: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay: number;
  private stopped = false;

  constructor(cfg: TunnelConfig) {
    this.cfg = cfg;
    this.reconnectDelay = cfg.reconnectInitialMs;
  }

  /** Start the agent: connect and set up signal handlers. */
  start(): void {
    this.connect();

    process.once('SIGTERM', () => this.stop());
    process.once('SIGINT',  () => this.stop());
  }

  /** Gracefully stop the agent. */
  stop(): void {
    this.stopped = true;
    this.clearTimers();
    destroyAllSockets();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1001, 'agent shutdown');
    }
    log('Agent stopped');
    // Allow WS close frame to flush before exiting
    setTimeout(() => process.exit(0), 500);
  }

  // ---------------------------------------------------------------------------
  // Connection management
  // ---------------------------------------------------------------------------

  private connect(): void {
    if (this.stopped) return;

    log(`Connecting to ${this.cfg.serverUrl} (gateway=${this.cfg.gatewayId})`);

    const options = buildWsOptions(this.cfg);
    const ws = new WebSocket(this.cfg.serverUrl, options);
    this.ws = ws;

    ws.on('open', () => {
      log(`Connected to TunnelBroker`);
      this.reconnectDelay = this.cfg.reconnectInitialMs; // reset backoff
      this.startPing(ws);
    });

    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      this.handleMessage(ws, data);
    });

    ws.on('close', (code, reason) => {
      this.clearTimers();
      destroyAllSockets();
      if (!this.stopped) {
        warn(`Connection closed (code=${code}, reason=${reason.toString()}). Reconnecting in ${this.reconnectDelay}ms`);
        this.scheduleReconnect();
      }
    });

    ws.on('error', (e) => {
      err(`WebSocket error: ${e.message}`);
      // 'close' event will fire after this — reconnect is scheduled there
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);

    // Exponential backoff
    this.reconnectDelay = Math.min(
      this.reconnectDelay * 2,
      this.cfg.reconnectMaxMs,
    );
  }

  private clearTimers(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Heartbeat / ping
  // ---------------------------------------------------------------------------

  private startPing(ws: WebSocket): void {
    this.pingTimer = setInterval(async () => {
      if (ws.readyState !== WebSocket.OPEN) {
        this.clearTimers();
        return;
      }

      const health = await this.probeLocalService();

      // Encode health metadata as JSON in the ping payload
      const payload = Buffer.from(JSON.stringify(health), 'utf8');
      const frame = buildFrame(MsgType.PING, 0, payload);
      ws.send(frame, (sendErr) => {
        if (sendErr) warn(`Failed to send PING: ${sendErr.message}`);
      });
    }, this.cfg.pingIntervalMs);
  }

  // ---------------------------------------------------------------------------
  // Frame handling
  // ---------------------------------------------------------------------------

  private handleMessage(ws: WebSocket, data: Buffer | ArrayBuffer | Buffer[]): void {
    const buf = Buffer.isBuffer(data)
      ? data
      : Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.from(data as ArrayBuffer);

    const frame = parseFrame(buf);
    if (!frame) {
      warn(`Frame too short (${buf.length} bytes) — ignored`);
      return;
    }

    const { type, streamId, payload } = frame;

    switch (type) {
      case MsgType.OPEN:
        handleOpenFrame(ws, streamId, payload);
        break;

      case MsgType.DATA:
        handleDataFrame(streamId, payload);
        break;

      case MsgType.CLOSE:
        handleCloseFrame(ws, streamId);
        break;

      case MsgType.PING:
        // Server sent a ping — respond with PONG
        ws.send(buildFrame(MsgType.PONG, streamId), (sendErr) => {
          if (sendErr) warn(`Failed to send PONG: ${sendErr.message}`);
        });
        break;

      case MsgType.PONG:
        // PONG received — heartbeat acknowledged (no-op)
        break;

      case MsgType.HEARTBEAT:
        // Server-initiated heartbeat — no action needed on the agent side
        break;

      case MsgType.CERT_RENEW:
        // TODO: Implement client certificate hot-reload when the server pushes a renewed cert
        warn('Certificate renewal via tunnel not yet implemented');
        break;

      default:
        warn(`Unknown message type ${type} — ignored`);
    }
  }

  // ---------------------------------------------------------------------------
  // Local service health probe
  // ---------------------------------------------------------------------------

  private probeLocalService(): Promise<HealthStatus> {
    return new Promise<HealthStatus>((resolve) => {
      const start = Date.now();
      let resolved = false;

      const socket = net.connect(
        this.cfg.localServicePort,
        this.cfg.localServiceHost,
      );

      const done = (healthy: boolean) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        if (!socket.destroyed) socket.destroy();
        resolve({
          healthy,
          latencyMs: Date.now() - start,
          activeStreams: activeStreamCount(),
        });
      };

      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));

      // Timeout after 2 s
      const timer = setTimeout(() => done(false), 2_000);
    });
  }
}
