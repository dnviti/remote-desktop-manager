/**
 * Tunnel WebSocket handler.
 *
 * Attaches a raw `ws` WebSocket server to the HTTP server at the path
 * `/api/tunnel/connect`. Gateway agents connect here with:
 *
 *   GET /api/tunnel/connect
 *   Upgrade: websocket
 *   Authorization: Bearer <tunnel-token>
 *   X-Gateway-Id: <gateway-uuid>
 *   X-Agent-Version: <semver>  (optional)
 *
 * The handler authenticates the request, then delegates to the TunnelBroker
 * (tunnel.service.ts) for frame multiplexing.
 */

import http from 'http';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import {
  authenticateTunnelRequest,
  registerTunnel,
} from '../services/tunnel.service';
import { logger } from '../utils/logger';

const log = logger.child('tunnel-handler');

export function setupTunnelHandler(server: http.Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  // Handle the HTTP upgrade
  server.on('upgrade', (req: http.IncomingMessage, socket: import('net').Socket, head: Buffer) => {
    if (req.url !== '/api/tunnel/connect') {
      return; // Let other upgrade handlers (e.g. Socket.IO) process this request
    }

    // Extract auth headers
    const authHeader = req.headers['authorization'] ?? '';
    const gatewayId  = (req.headers['x-gateway-id'] as string | undefined) ?? '';
    const agentVersion = (req.headers['x-agent-version'] as string | undefined) ?? undefined;

    const bearerToken = authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : '';

    if (!bearerToken || !gatewayId) {
      log.warn('[tunnel] Upgrade rejected: missing Authorization or X-Gateway-Id header');
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    // Authenticate asynchronously before completing the upgrade
    authenticateTunnelRequest(gatewayId, bearerToken)
      .then((result) => {
        if (!result) {
          log.warn(`[tunnel] Upgrade rejected: invalid credentials for gateway ${gatewayId}`);
          socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }

        // Complete WebSocket upgrade
        wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
          wss.emit('connection', ws, req, result.id, agentVersion);
        });
      })
      .catch((err: Error) => {
        log.error(`[tunnel] Auth error for gateway ${gatewayId}: ${err.message}`);
        socket.write('HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n');
        socket.destroy();
      });
  });

  // Handle authenticated connections
  wss.on('connection', (ws: WebSocket, _req: http.IncomingMessage, gatewayId: string, agentVersion?: string) => {
    const clientIp = extractRemoteIp(_req);
    registerTunnel(gatewayId, ws, agentVersion, clientIp);
    // close/error handlers are attached in attachFrameHandler (tunnel.service.ts)
  });

  log.info('[tunnel] WebSocket handler attached at /api/tunnel/connect');
  return wss;
}

function extractRemoteIp(req: http.IncomingMessage): string | undefined {
  const socketAddr = req.socket.remoteAddress ?? undefined;
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    const forwardedIp = first?.trim();
    if (forwardedIp && forwardedIp !== socketAddr) {
      log.info(`[tunnel] Remote IP ${socketAddr ?? 'unknown'}, X-Forwarded-For: ${forwardedIp}`);
    }
  }
  return socketAddr;
}
