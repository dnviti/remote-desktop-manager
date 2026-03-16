/**
 * Authentication helpers for the tunnel agent.
 *
 * Builds the WebSocket connection options including:
 * - Authorization Bearer header
 * - X-Gateway-Id / X-Agent-Version headers
 * - Optional mTLS (client cert + CA cert via TLS options)
 */

import type { ClientOptions } from 'ws';
import type { TunnelConfig } from './config';

/**
 * Build the `ws` ClientOptions for the TunnelBroker WebSocket connection,
 * incorporating auth headers and optional TLS certificates.
 *
 * `ClientOptions` extends `SecureContextOptions`, so `ca`, `cert`, and `key`
 * are flat properties — not nested under a `.tls` sub-object.
 */
export function buildWsOptions(cfg: TunnelConfig): ClientOptions {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.token}`,
    'X-Gateway-Id': cfg.gatewayId,
    'X-Agent-Version': cfg.agentVersion,
  };

  return {
    headers,
    handshakeTimeout: 10_000,
    // CA cert for server verification (optional)
    ...(cfg.caCert ? { ca: cfg.caCert } : {}),
    // Client certificate + key for mTLS (optional)
    ...(cfg.clientCert && cfg.clientKey
      ? { cert: cfg.clientCert, key: cfg.clientKey }
      : {}),
  };
}
