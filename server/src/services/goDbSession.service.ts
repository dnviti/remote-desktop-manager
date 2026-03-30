import { config } from '../config';
import { AppError } from '../middleware/error.middleware';
import type { DbSessionConfig } from '../types';

interface RoutingDecision {
  strategy: string;
  candidateCount: number;
  selectedSessionCount: number;
}

export interface IssueDatabaseSessionRequest {
  userId: string;
  connectionId: string;
  gatewayId?: string;
  instanceId?: string;
  protocol: 'DATABASE';
  ipAddress?: string;
  username: string;
  proxyHost: string;
  proxyPort: number;
  databaseName?: string;
  sessionMetadata?: Record<string, unknown>;
  routingDecision?: RoutingDecision;
  target: {
    protocol: 'postgresql';
    host: string;
    port: number;
    database?: string;
    sslMode?: 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full';
    username: string;
    password: string;
    sessionConfig?: DbSessionConfig;
  };
}

export interface IssueDatabaseSessionResponse {
  sessionId: string;
  proxyHost: string;
  proxyPort: number;
  protocol: string;
  databaseName?: string;
  username?: string;
}

export interface DatabaseSessionLifecycleRequest {
  userId: string;
  reason?: string;
}

export interface DatabaseSessionConfigRequest {
  userId: string;
  sessionConfig?: DbSessionConfig;
  target?: IssueDatabaseSessionRequest['target'];
}

export interface DatabaseSessionConfigResponse {
  applied: boolean;
  activeDatabase?: string;
  sessionConfig?: DbSessionConfig;
}

function resolveUrl(): string {
  return config.goControlPlaneApiUrl.replace(/\/+$/, '');
}

async function parseError(response: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const body = await response.json() as { error?: string };
    if (body?.error) message = body.error;
  } catch {
    // ignore malformed error body
  }
  throw new AppError(message, response.status >= 500 ? 502 : response.status);
}

export async function issueDatabaseSession(req: IssueDatabaseSessionRequest): Promise<IssueDatabaseSessionResponse> {
  const response = await fetch(`${resolveUrl()}/v1/database/sessions:issue`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (!response.ok) {
    return await parseError(response, `Go control plane returned status ${response.status}`);
  }

  return await response.json() as IssueDatabaseSessionResponse;
}

export async function heartbeatDatabaseSession(sessionId: string, req: DatabaseSessionLifecycleRequest): Promise<void> {
  const response = await fetch(`${resolveUrl()}/v1/database/sessions/${encodeURIComponent(sessionId)}/heartbeat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (!response.ok) {
    await parseError(response, `Go control plane returned status ${response.status}`);
  }
}

export async function endDatabaseSession(sessionId: string, req: DatabaseSessionLifecycleRequest): Promise<void> {
  const response = await fetch(`${resolveUrl()}/v1/database/sessions/${encodeURIComponent(sessionId)}/end`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (!response.ok) {
    await parseError(response, `Go control plane returned status ${response.status}`);
  }
}

export function usesDelegatableDatabaseSessionConfig(sessionConfig?: DbSessionConfig): boolean {
  void sessionConfig;
  return true;
}

export async function updateDatabaseSessionConfig(
  sessionId: string,
  req: DatabaseSessionConfigRequest,
): Promise<DatabaseSessionConfigResponse> {
  const response = await fetch(`${resolveUrl()}/v1/database/sessions/${encodeURIComponent(sessionId)}/config`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (!response.ok) {
    return await parseError(response, `Go control plane returned status ${response.status}`);
  }

  return await response.json() as DatabaseSessionConfigResponse;
}

export async function getDatabaseSessionConfig(sessionId: string, userId: string): Promise<DbSessionConfig> {
  const response = await fetch(
    `${resolveUrl()}/v1/database/sessions/${encodeURIComponent(sessionId)}/config?userId=${encodeURIComponent(userId)}`,
    { method: 'GET' },
  );

  if (!response.ok) {
    return await parseError(response, `Go control plane returned status ${response.status}`);
  }

  return await response.json() as DbSessionConfig;
}
