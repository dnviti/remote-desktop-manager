/**
 * Tunnel agent configuration.
 *
 * Reads all configuration from environment variables.
 * If TUNNEL_SERVER_URL is absent the agent exits cleanly (dormant mode).
 */

import fs from 'fs';
import path from 'path';

function getPackageVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, '..', 'package.json');
    // The path is constructed from the agent's fixed package root.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export interface TunnelConfig {
  /** WSS URL of the TunnelBroker server, e.g. wss://my-server.example.com/tunnel */
  serverUrl: string;
  /** Bearer token used in the Authorization header */
  token: string;
  /** Gateway identifier sent in X-Gateway-Id header */
  gatewayId: string;
  /** PEM-encoded CA certificate (optional, used to verify server cert) */
  caCert?: string;
  /** PEM-encoded client certificate (optional, for mTLS) */
  clientCert?: string;
  /** PEM-encoded client private key (optional, for mTLS) */
  clientKey?: string;
  /** Agent version string sent in X-Agent-Version header */
  agentVersion: string;
  /** Heartbeat / ping interval in milliseconds (default: 15 000) */
  pingIntervalMs: number;
  /** Initial reconnect backoff in milliseconds (default: 1 000) */
  reconnectInitialMs: number;
  /** Maximum reconnect backoff in milliseconds (default: 60 000) */
  reconnectMaxMs: number;
  /** Target host of the proxied local service (default: 127.0.0.1) */
  localServiceHost: string;
  /** Target port of the proxied local service — mandatory */
  localServicePort: number;
}

function readOptionalPem(inlineValue: string | undefined, filePathValue: string | undefined, label: string): string | undefined {
  const inline = inlineValue?.trim();
  if (inline) {
    return inline;
  }

  const filePath = filePathValue?.trim();
  if (!filePath) {
    return undefined;
  }

  try {
    // File paths come from the explicitly named *_FILE environment variables.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const contents = fs.readFileSync(filePath, 'utf8').trim();
    return contents || undefined;
  } catch (err) {
    process.stderr.write(
      `[tunnel-agent] Failed to read ${label} from ${filePath}: ${err instanceof Error ? err.message : 'Unknown error'}\n`,
    );
    process.exit(1);
  }
}

/** Build config from environment. Returns null if tunnel env vars are absent (dormant mode). */
export function loadConfig(): TunnelConfig | null {
  const serverUrl = process.env.TUNNEL_SERVER_URL?.trim();
  const token = process.env.TUNNEL_TOKEN?.trim();
  const gatewayId = process.env.TUNNEL_GATEWAY_ID?.trim();
  const localServicePortStr = process.env.TUNNEL_LOCAL_PORT?.trim();

  // If none of the tunnel vars are set, remain dormant
  if (!serverUrl && !token && !gatewayId) {
    return null;
  }

  // If some but not all required vars are set, warn and exit
  const missing: string[] = [];
  if (!serverUrl) missing.push('TUNNEL_SERVER_URL');
  if (!token) missing.push('TUNNEL_TOKEN');
  if (!gatewayId) missing.push('TUNNEL_GATEWAY_ID');
  if (!localServicePortStr) missing.push('TUNNEL_LOCAL_PORT');

  if (missing.length > 0) {
    process.stderr.write(
      `[tunnel-agent] Missing required environment variables: ${missing.join(', ')}\n`,
    );
    process.exit(1);
  }

  // At this point all required vars are set (missing.length === 0 or we exited)
  const resolvedServerUrl = serverUrl as string;
  const resolvedToken = token as string;
  const resolvedGatewayId = gatewayId as string;
  const resolvedPortStr = localServicePortStr as string;

  const localServicePort = parseInt(resolvedPortStr, 10);
  if (isNaN(localServicePort) || localServicePort < 1 || localServicePort > 65535) {
    process.stderr.write(
      `[tunnel-agent] TUNNEL_LOCAL_PORT must be a valid port number (1-65535)\n`,
    );
    process.exit(1);
  }

  return {
    serverUrl: resolvedServerUrl,
    token: resolvedToken,
    gatewayId: resolvedGatewayId,
    caCert: readOptionalPem(process.env.TUNNEL_CA_CERT, process.env.TUNNEL_CA_CERT_FILE, 'TUNNEL_CA_CERT'),
    clientCert: readOptionalPem(process.env.TUNNEL_CLIENT_CERT, process.env.TUNNEL_CLIENT_CERT_FILE, 'TUNNEL_CLIENT_CERT'),
    clientKey: readOptionalPem(process.env.TUNNEL_CLIENT_KEY, process.env.TUNNEL_CLIENT_KEY_FILE, 'TUNNEL_CLIENT_KEY'),
    agentVersion: process.env.TUNNEL_AGENT_VERSION?.trim() || getPackageVersion(),
    pingIntervalMs: parseInt(process.env.TUNNEL_PING_INTERVAL_MS || '15000', 10),
    reconnectInitialMs: parseInt(process.env.TUNNEL_RECONNECT_INITIAL_MS || '1000', 10),
    reconnectMaxMs: parseInt(process.env.TUNNEL_RECONNECT_MAX_MS || '60000', 10),
    localServiceHost: process.env.TUNNEL_LOCAL_HOST?.trim() || '127.0.0.1',
    localServicePort,
  };
}
