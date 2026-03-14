import api from './client';

export interface VaultProviderData {
  id: string;
  name: string;
  serverUrl: string;
  authMethod: 'TOKEN' | 'APPROLE';
  namespace: string | null;
  mountPath: string;
  cacheTtlSeconds: number;
  caCertificate?: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateVaultProviderInput {
  name: string;
  serverUrl: string;
  authMethod: 'TOKEN' | 'APPROLE';
  namespace?: string;
  mountPath?: string;
  authPayload: string;
  caCertificate?: string;
  cacheTtlSeconds?: number;
}

export interface UpdateVaultProviderInput {
  name?: string;
  serverUrl?: string;
  authMethod?: 'TOKEN' | 'APPROLE';
  namespace?: string | null;
  mountPath?: string;
  authPayload?: string;
  caCertificate?: string | null;
  cacheTtlSeconds?: number;
  enabled?: boolean;
}

export interface TestResult {
  success: boolean;
  keys?: string[];
  error?: string;
}

export async function listVaultProviders(): Promise<VaultProviderData[]> {
  const { data } = await api.get('/vault-providers');
  return data;
}

export async function getVaultProvider(providerId: string): Promise<VaultProviderData> {
  const { data } = await api.get(`/vault-providers/${providerId}`);
  return data;
}

export async function createVaultProvider(input: CreateVaultProviderInput): Promise<VaultProviderData> {
  const { data } = await api.post('/vault-providers', input);
  return data;
}

export async function updateVaultProvider(providerId: string, input: UpdateVaultProviderInput): Promise<VaultProviderData> {
  const { data } = await api.put(`/vault-providers/${providerId}`, input);
  return data;
}

export async function deleteVaultProvider(providerId: string): Promise<void> {
  await api.delete(`/vault-providers/${providerId}`);
}

export async function testVaultProvider(providerId: string, secretPath: string): Promise<TestResult> {
  const { data } = await api.post(`/vault-providers/${providerId}/test`, { secretPath });
  return data;
}
