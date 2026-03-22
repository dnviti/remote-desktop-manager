import api from './client';

export interface ActiveSessionDTO {
  id: string;
  userId: string;
  username: string | null;
  email: string;
  connectionId: string;
  connectionName: string;
  connectionHost: string;
  connectionPort: number;
  gatewayId: string | null;
  gatewayName: string | null;
  protocol: 'SSH' | 'RDP' | 'VNC' | 'SSH_PROXY';
  status: 'ACTIVE' | 'IDLE' | 'CLOSED';
  startedAt: string;
  lastActivityAt: string;
  endedAt: string | null;
  durationFormatted: string;
}

export interface SessionFilters {
  protocol?: 'SSH' | 'RDP' | 'VNC' | 'SSH_PROXY';
  status?: 'ACTIVE' | 'IDLE' | 'CLOSED';
  gatewayId?: string;
}

export interface GatewaySessionCount {
  gatewayId: string;
  gatewayName: string;
  count: number;
}

export async function getActiveSessions(filters?: SessionFilters): Promise<ActiveSessionDTO[]> {
  const params = new URLSearchParams();
  if (filters?.protocol) params.set('protocol', filters.protocol);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.gatewayId) params.set('gatewayId', filters.gatewayId);
  const { data } = await api.get('/sessions/active', { params });
  return data;
}

export async function getSessionCount(): Promise<number> {
  const { data } = await api.get('/sessions/count');
  return data.count;
}

export async function getSessionCountByGateway(): Promise<GatewaySessionCount[]> {
  const { data } = await api.get('/sessions/count/gateway');
  return data;
}

export async function terminateSession(sessionId: string): Promise<void> {
  await api.post(`/sessions/${sessionId}/terminate`);
}

// ---------------------------------------------------------------------------
// SSH Proxy
// ---------------------------------------------------------------------------

export interface SshProxyTokenResponse {
  token: string;
  expiresIn: number;
  connectionInstructions: {
    command: string;
    port: number;
    host: string;
    note: string;
  };
}

export interface SshProxyStatus {
  enabled: boolean;
  port: number;
  listening: boolean;
  activeSessions: number;
  allowedAuthMethods: string[];
}

export async function createSshProxyToken(connectionId: string): Promise<SshProxyTokenResponse> {
  const { data } = await api.post('/sessions/ssh-proxy/token', { connectionId });
  return data;
}

export async function getSshProxyStatus(): Promise<SshProxyStatus> {
  const { data } = await api.get('/sessions/ssh-proxy/status');
  return data;
}
