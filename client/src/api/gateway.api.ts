import api from './client';

export interface GatewayData {
  id: string;
  name: string;
  type: 'GUACD' | 'SSH_BASTION';
  host: string;
  port: number;
  description: string | null;
  isDefault: boolean;
  hasSshKey: boolean;
  tenantId: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayInput {
  name: string;
  type: 'GUACD' | 'SSH_BASTION';
  host: string;
  port: number;
  description?: string;
  isDefault?: boolean;
  username?: string;
  password?: string;
  sshPrivateKey?: string;
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
}

export interface TestResult {
  reachable: boolean;
  latencyMs: number | null;
  error: string | null;
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
