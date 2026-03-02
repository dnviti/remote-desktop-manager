import api from './client';

export interface GatewayData {
  id: string;
  name: string;
  type: 'GUACD' | 'SSH_BASTION' | 'MANAGED_SSH';
  host: string;
  port: number;
  description: string | null;
  isDefault: boolean;
  hasSshKey: boolean;
  apiPort: number | null;
  tenantId: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayInput {
  name: string;
  type: 'GUACD' | 'SSH_BASTION' | 'MANAGED_SSH';
  host: string;
  port: number;
  description?: string;
  isDefault?: boolean;
  username?: string;
  password?: string;
  sshPrivateKey?: string;
  apiPort?: number;
}

export interface GatewayUpdate {
  name?: string;
  host?: string;
  port?: number;
  description?: string | null;
  isDefault?: boolean;
  username?: string;
  password?: string;
  sshPrivateKey?: string;
  apiPort?: number | null;
}

export interface TestResult {
  reachable: boolean;
  latencyMs: number | null;
  error: string | null;
}

export interface SshKeyPairData {
  id: string;
  publicKey: string;
  fingerprint: string;
  algorithm: string;
  createdAt: string;
  updatedAt: string;
}

export async function listGateways(): Promise<GatewayData[]> {
  const res = await api.get('/gateways');
  return res.data;
}

export async function createGateway(data: GatewayInput): Promise<GatewayData> {
  const res = await api.post('/gateways', data);
  return res.data;
}

export async function updateGateway(id: string, data: GatewayUpdate): Promise<GatewayData> {
  const res = await api.put(`/gateways/${id}`, data);
  return res.data;
}

export async function deleteGateway(id: string): Promise<{ deleted: boolean }> {
  const res = await api.delete(`/gateways/${id}`);
  return res.data;
}

export async function testGateway(id: string): Promise<TestResult> {
  const res = await api.post(`/gateways/${id}/test`);
  return res.data;
}

export async function getSshKeyPair(): Promise<SshKeyPairData> {
  const res = await api.get('/gateways/ssh-keypair');
  return res.data;
}

export async function generateSshKeyPair(): Promise<SshKeyPairData> {
  const res = await api.post('/gateways/ssh-keypair');
  return res.data;
}

export interface KeyPushResult {
  gatewayId: string;
  name: string;
  ok: boolean;
  error?: string;
}

export interface RotateKeyPairResponse extends SshKeyPairData {
  pushResults?: KeyPushResult[];
}

export async function rotateSshKeyPair(): Promise<RotateKeyPairResponse> {
  const res = await api.post('/gateways/ssh-keypair/rotate');
  return res.data;
}

export async function pushKeyToGateway(id: string): Promise<{ ok: boolean; error?: string }> {
  const res = await api.post(`/gateways/${id}/push-key`);
  return res.data;
}

export async function downloadSshPrivateKey(): Promise<string> {
  const res = await api.get('/gateways/ssh-keypair/private', { responseType: 'text' });
  return res.data;
}
