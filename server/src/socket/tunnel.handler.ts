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

import crypto from 'crypto';
import http from 'http';
import type https from 'https';
import type tls from 'tls';
import WS, { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import {
  authenticateTunnelRequest,
  MsgType,
  noteProxiedTunnelActivity,
  noteProxiedTunnelConnected,
  noteProxiedTunnelDisconnected,
  registerTunnel,
} from '../services/tunnel.service';
import * as auditService from '../services/audit.service';
import { config } from '../config';
import { logger } from '../utils/logger';
import {
  buildGatewaySpiffeId,
  extractSpiffeIdFromCertPem,
  spiffeIdEquals,
} from '../utils/spiffe';

const log = logger.child('tunnel-handler');

export function setupTunnelHandler(server: http.Server | https.Server): WebSocketServer {
  if (config.goTunnelBrokerEnabled) {
    return setupTunnelProxyHandler(server);
  }

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

    // -----------------------------------------------------------------------
    // mTLS enforcement — verify client certificate identity
    // -----------------------------------------------------------------------
    let clientCertPem: string | undefined;
    const expectedSpiffeId = buildGatewaySpiffeId(config.spiffeTrustDomain, gatewayId);

    const tlsSocket = req.socket as tls.TLSSocket;
    if (typeof tlsSocket.getPeerCertificate === 'function') {
      const peerCert = tlsSocket.getPeerCertificate(false);
      if (peerCert && peerCert.raw) {
        // TLS-terminated connection with client cert
        const b64 = peerCert.raw.toString('base64');
        const pemLines = b64.match(/.{1,64}/g) ?? [b64];
        clientCertPem = `-----BEGIN CERTIFICATE-----\n${pemLines.join('\n')}\n-----END CERTIFICATE-----`;
        const actualSpiffeId = extractSpiffeIdFromCertPem(clientCertPem);
        if (!spiffeIdEquals(actualSpiffeId, expectedSpiffeId)) {
          log.warn(`[tunnel] Upgrade rejected: client SPIFFE ID "${actualSpiffeId ?? 'missing'}" does not match gateway ${gatewayId}`);
          auditService.log({ action: 'TUNNEL_MTLS_REJECTED', targetType: 'Gateway', targetId: gatewayId, details: { reason: 'spiffe_id_mismatch', expectedSpiffeId, actualSpiffeId }, ipAddress: req.socket.remoteAddress });
          socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\nClient certificate SPIFFE ID mismatch');
          socket.destroy();
          return;
        }
        const cert = new crypto.X509Certificate(clientCertPem);
        if (Date.parse(cert.validTo) < Date.now()) {
          log.warn(`[tunnel] Upgrade rejected: client cert for gateway ${gatewayId} has expired`);
          auditService.log({ action: 'TUNNEL_MTLS_REJECTED', targetType: 'Gateway', targetId: gatewayId, details: { reason: 'cert_expired', expiry: cert.validTo }, ipAddress: req.socket.remoteAddress });
          socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\nClient certificate expired');
          socket.destroy();
          return;
        }
      }
    }

    // If no TLS cert, check proxy-forwarded client cert headers (only when proxy is trusted)
    if (!clientCertPem && config.trustProxy && !config.tunnelStrictMtls) {
      // Verify the request originates from a trusted proxy IP
      const sourceIp = req.socket.remoteAddress ?? '';
      const trustedIps = config.tunnelTrustedProxyIps;
      if (trustedIps.length > 0 && !trustedIps.includes(sourceIp)) {
        log.warn(`[tunnel] Upgrade rejected: proxy IP ${sourceIp} not in trusted proxy list for gateway ${gatewayId}`);
        auditService.log({ action: 'TUNNEL_MTLS_REJECTED', targetType: 'Gateway', targetId: gatewayId, details: { reason: 'untrusted_proxy_ip', sourceIp }, ipAddress: sourceIp });
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\nUntrusted proxy IP');
        socket.destroy();
        return;
      }

      const proxyVerifiedRaw = req.headers['x-client-cert-verified'];
      const proxyVerified = Array.isArray(proxyVerifiedRaw) ? proxyVerifiedRaw[0] : proxyVerifiedRaw;

      // Require the full client cert PEM for CA chain validation
      const proxyClientCertRaw = req.headers['x-client-cert'];
      const proxyClientCert = Array.isArray(proxyClientCertRaw) ? proxyClientCertRaw[0] : proxyClientCertRaw;

      if (proxyVerified === 'SUCCESS') {
        // Decode URL-encoded PEM from the proxy header
        if (proxyClientCert) {
          try {
            clientCertPem = decodeURIComponent(proxyClientCert);
            const actualSpiffeId = extractSpiffeIdFromCertPem(clientCertPem);
            if (!spiffeIdEquals(actualSpiffeId, expectedSpiffeId)) {
              log.warn(`[tunnel] Upgrade rejected: proxy-forwarded SPIFFE ID "${actualSpiffeId ?? 'missing'}" does not match gateway ${gatewayId}`);
              auditService.log({ action: 'TUNNEL_MTLS_REJECTED', targetType: 'Gateway', targetId: gatewayId, details: { reason: 'proxy_spiffe_id_mismatch', expectedSpiffeId, actualSpiffeId }, ipAddress: sourceIp });
              socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\nClient certificate SPIFFE ID mismatch');
              socket.destroy();
              return;
            }
          } catch {
            log.warn(`[tunnel] Upgrade rejected: malformed x-client-cert header for gateway ${gatewayId}`);
            auditService.log({ action: 'TUNNEL_MTLS_REJECTED', targetType: 'Gateway', targetId: gatewayId, details: { reason: 'malformed_proxy_cert' }, ipAddress: sourceIp });
            socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\nMalformed client certificate header');
            socket.destroy();
            return;
          }
        } else {
          log.warn(`[tunnel] Upgrade rejected: trusted proxy omitted x-client-cert for gateway ${gatewayId}`);
          auditService.log({ action: 'TUNNEL_MTLS_REJECTED', targetType: 'Gateway', targetId: gatewayId, details: { reason: 'missing_proxy_cert' }, ipAddress: sourceIp });
          socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\nClient certificate required');
          socket.destroy();
          return;
        }
      }
    }

    // No client certificate at all — reject
    if (!clientCertPem) {
      log.warn(`[tunnel] Upgrade rejected: no client certificate for gateway ${gatewayId}`);
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\nClient certificate required');
      socket.destroy();
      return;
    }

    // Authenticate asynchronously before completing the upgrade
    authenticateTunnelRequest(gatewayId, bearerToken, clientCertPem)
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

function setupTunnelProxyHandler(server: http.Server | https.Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: http.IncomingMessage, socket: import('net').Socket, head: Buffer) => {
    if (req.url !== '/api/tunnel/connect') {
      return;
    }

    const authHeader = req.headers['authorization'] ?? '';
    const gatewayId = (req.headers['x-gateway-id'] as string | undefined) ?? '';
    const agentVersion = (req.headers['x-agent-version'] as string | undefined) ?? undefined;
    const bearerToken = authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : '';

    if (!bearerToken || !gatewayId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const clientCertPem = extractPeerClientCertificatePem(req);
    if (!clientCertPem) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\nClient certificate required');
      socket.destroy();
      return;
    }

    const upstream = new WS(tunnelBrokerWebSocketUrl(), {
      handshakeTimeout: 10_000,
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        'X-Gateway-Id': gatewayId,
        ...(agentVersion ? { 'X-Agent-Version': agentVersion } : {}),
        'X-Client-Cert': encodeURIComponent(clientCertPem),
        'X-Client-Cert-Verified': 'SUCCESS',
        ...(extractRemoteIp(req) ? { 'X-Forwarded-For': extractRemoteIp(req)! } : {}),
      },
    });

    let upgraded = false;
    const rejectUpgrade = (statusCode: number, message: string) => {
      if (upgraded || socket.destroyed) return;
      socket.write(`HTTP/1.1 ${statusCode} ${http.STATUS_CODES[statusCode] ?? 'Error'}\r\nConnection: close\r\n\r\n${message}`);
      socket.destroy();
    };

    upstream.once('unexpected-response', (_upstreamReq, response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on('end', () => {
        rejectUpgrade(response.statusCode || 502, Buffer.concat(chunks).toString('utf8') || 'Tunnel broker rejected the connection');
      });
    });

    upstream.once('error', (err) => {
      rejectUpgrade(502, `Tunnel broker unavailable: ${err.message}`);
    });

    upstream.once('open', () => {
      wss.handleUpgrade(req, socket, head, (downstream: WebSocket) => {
        upgraded = true;
        wss.emit('connection', downstream, req, gatewayId, agentVersion, upstream);
      });
    });
  });

  wss.on('connection', (
    downstream: WebSocket,
    req: http.IncomingMessage,
    gatewayId: string,
    agentVersion?: string,
    upstream?: WS,
  ) => {
    if (!upstream) {
      downstream.close(1011, 'missing upstream tunnel broker');
      return;
    }

    const clientIp = extractRemoteIp(req);
    noteProxiedTunnelConnected(gatewayId, agentVersion, clientIp);

    let closed = false;
    const shutdown = () => {
      if (closed) return;
      closed = true;
      noteProxiedTunnelDisconnected(gatewayId);
      try { upstream.close(); } catch { /* ignore */ }
      try { downstream.close(); } catch { /* ignore */ }
    };

    downstream.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      const buf = toBuffer(data);
      recordProxyActivity(gatewayId, buf);
      upstream.send(buf, (err) => {
        if (err) shutdown();
      });
    });

    upstream.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      const buf = toBuffer(data);
      downstream.send(buf, (err) => {
        if (err) shutdown();
      });
    });

    downstream.on('close', shutdown);
    upstream.on('close', shutdown);
    downstream.on('error', shutdown);
    upstream.on('error', shutdown);
  });

  log.info('[tunnel] Proxying tunnel websocket traffic to Go tunnel-broker at /api/tunnel/connect');
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

function extractPeerClientCertificatePem(req: http.IncomingMessage): string | null {
  const tlsSocket = req.socket as tls.TLSSocket;
  if (typeof tlsSocket.getPeerCertificate !== 'function') {
    return null;
  }

  const peerCert = tlsSocket.getPeerCertificate(false);
  if (!peerCert || !peerCert.raw) {
    return null;
  }

  const b64 = peerCert.raw.toString('base64');
  const pemLines = b64.match(/.{1,64}/g) ?? [b64];
  return `-----BEGIN CERTIFICATE-----\n${pemLines.join('\n')}\n-----END CERTIFICATE-----`;
}

function tunnelBrokerWebSocketUrl(): string {
  const base = config.goTunnelBrokerUrl.replace(/\/+$/, '');
  if (base.startsWith('https://')) {
    return `${base.replace(/^https:/, 'wss:')}/api/tunnel/connect`;
  }
  return `${base.replace(/^http:/, 'ws:')}/api/tunnel/connect`;
}

function toBuffer(data: Buffer | ArrayBuffer | Buffer[]): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data as ArrayBuffer);
}

function recordProxyActivity(gatewayId: string, buf: Buffer): void {
  if (buf.length < 4) {
    noteProxiedTunnelActivity(gatewayId, undefined, buf.length);
    return;
  }
  const type = buf[0];
  const payload = buf.subarray(4);
  if (type === MsgType.PING || type === MsgType.HEARTBEAT) {
    noteProxiedTunnelActivity(gatewayId, payload, buf.length);
    return;
  }
  noteProxiedTunnelActivity(gatewayId, undefined, buf.length);
}
