import api from './client';

export interface GatewaySessionCount {
  gatewayId: string;
  gatewayName: string;
  count: number;
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

export interface SshProxyStatus {
  enabled: boolean;
  port: number;
  listening: boolean;
  activeSessions: number;
  allowedAuthMethods: string[];
}

export async function getSshProxyStatus(): Promise<SshProxyStatus> {
  const { data } = await api.get('/sessions/ssh-proxy/status');
  return data;
}
