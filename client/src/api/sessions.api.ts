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
  protocol: 'SSH' | 'RDP';
  status: 'ACTIVE' | 'IDLE' | 'CLOSED';
  startedAt: string;
  lastActivityAt: string;
  endedAt: string | null;
  durationFormatted: string;
}

export interface SessionFilters {
  protocol?: 'SSH' | 'RDP';
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
  const res = await api.get('/sessions/active', { params });
  return res.data;
}

export async function getSessionCount(): Promise<number> {
  const res = await api.get('/sessions/count');
  return res.data.count;
}

export async function getSessionCountByGateway(): Promise<GatewaySessionCount[]> {
  const res = await api.get('/sessions/count/gateway');
  return res.data;
}

export async function terminateSession(sessionId: string): Promise<void> {
  await api.post(`/sessions/${sessionId}/terminate`);
}
