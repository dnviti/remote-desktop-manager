import api from './client';
import type { ResolvedDlpPolicy } from './connections.api';
import type { SshTerminalConfig } from '../constants/terminalThemes';

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

export interface StartSshSessionInput {
  connectionId: string;
  username?: string;
  password?: string;
  domain?: string;
  credentialMode?: 'saved' | 'domain' | 'manual';
}

export interface TerminalBrokerSshSessionResponse {
  transport: 'terminal-broker';
  sessionId: string;
  token: string;
  expiresAt: string;
  webSocketPath: string;
  webSocketUrl: string;
  dlpPolicy: ResolvedDlpPolicy;
  enforcedSshSettings: Partial<SshTerminalConfig> | null;
  sftpSupported: boolean;
}

export type StartSshSessionResponse = TerminalBrokerSshSessionResponse;

export async function startSshSession(payload: StartSshSessionInput): Promise<StartSshSessionResponse> {
  const { data } = await api.post('/sessions/ssh', payload);
  return data;
}

export async function endSshSession(sessionId: string): Promise<void> {
  await api.post(`/sessions/ssh/${sessionId}/end`, {});
}
