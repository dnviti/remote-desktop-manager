import { AppError } from '../middleware/error.middleware';
import { config } from '../config';

export interface TunnelBrokerProxyDescriptor {
  id: string;
  host: string;
  port: number;
  expiresInMs?: number;
}

export interface TunnelBrokerHeartbeat {
  healthy: boolean;
  latencyMs?: number;
  activeStreams?: number;
  bytesIn?: number;
  bytesOut?: number;
}

export interface TunnelBrokerStatus {
  gatewayId: string;
  connected: boolean;
  connectedAt?: string;
  lastHeartbeatAt?: string;
  clientVersion?: string;
  clientIp?: string;
  activeStreams?: number;
  bytesTransferred?: number;
  pingPongLatencyMs?: number;
  heartbeat?: TunnelBrokerHeartbeat;
}

interface TunnelBrokerErrorBody {
  error?: string;
}

function brokerBaseUrl(): string {
  return config.goTunnelBrokerUrl.replace(/\/+$/, '');
}

async function parseBrokerError(response: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const body = await response.json() as TunnelBrokerErrorBody;
    if (typeof body.error === 'string' && body.error.trim()) {
      message = body.error.trim();
    }
  } catch {
    // ignore parse failures
  }
  throw new AppError(message, response.status || 502);
}

export async function createTunnelProxy(
  gatewayId: string,
  targetHost: string,
  targetPort: number,
): Promise<TunnelBrokerProxyDescriptor> {
  const response = await fetch(`${brokerBaseUrl()}/v1/tcp-proxies`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      gatewayId,
      targetHost,
      targetPort,
    }),
  });

  if (!response.ok) {
    await parseBrokerError(response, `Tunnel broker returned ${response.status}`);
  }

  const payload = await response.json() as TunnelBrokerProxyDescriptor;
  if (!payload.host || !payload.port) {
    throw new AppError('Tunnel broker returned an invalid proxy descriptor', 502);
  }
  return payload;
}

export async function disconnectTunnelConnection(gatewayId: string): Promise<void> {
  const response = await fetch(`${brokerBaseUrl()}/v1/tunnels/${encodeURIComponent(gatewayId)}`, {
    method: 'DELETE',
  });

  if (response.status === 404) {
    return;
  }

  if (!response.ok) {
    await parseBrokerError(response, `Tunnel broker returned ${response.status}`);
  }
}

export async function listTunnelConnections(): Promise<TunnelBrokerStatus[]> {
  const response = await fetch(`${brokerBaseUrl()}/v1/tunnels`);
  if (!response.ok) {
    await parseBrokerError(response, `Tunnel broker returned ${response.status}`);
  }

  const payload = await response.json() as { tunnels?: TunnelBrokerStatus[] };
  return Array.isArray(payload.tunnels) ? payload.tunnels : [];
}

export async function getTunnelConnection(gatewayId: string): Promise<TunnelBrokerStatus | null> {
  const response = await fetch(`${brokerBaseUrl()}/v1/tunnels/${encodeURIComponent(gatewayId)}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    await parseBrokerError(response, `Tunnel broker returned ${response.status}`);
  }

  return await response.json() as TunnelBrokerStatus;
}
