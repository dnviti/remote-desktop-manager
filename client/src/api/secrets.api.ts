import axios from 'axios';
import api from './client';

// --- Secret payload types (discriminated union) ---

export interface LoginData {
  type: 'LOGIN';
  username: string;
  password: string;
  domain?: string;
  url?: string;
  notes?: string;
}

export interface SshKeyData {
  type: 'SSH_KEY';
  username?: string;
  privateKey: string;
  publicKey?: string;
  passphrase?: string;
  algorithm?: string;
  notes?: string;
}

export interface CertificateData {
  type: 'CERTIFICATE';
  certificate: string;
  privateKey: string;
  chain?: string;
  passphrase?: string;
  expiresAt?: string;
  notes?: string;
}

export interface ApiKeyData {
  type: 'API_KEY';
  apiKey: string;
  endpoint?: string;
  headers?: Record<string, string>;
  notes?: string;
}

export interface SecureNoteData {
  type: 'SECURE_NOTE';
  content: string;
}

export type SecretPayload =
  | LoginData
  | SshKeyData
  | CertificateData
  | ApiKeyData
  | SecureNoteData;

export type SecretType = 'LOGIN' | 'SSH_KEY' | 'CERTIFICATE' | 'API_KEY' | 'SECURE_NOTE';
export type SecretScope = 'PERSONAL' | 'TEAM' | 'TENANT';

// --- List / detail shapes ---

export interface SecretListItem {
  id: string;
  name: string;
  description: string | null;
  type: SecretType;
  scope: SecretScope;
  teamId: string | null;
  tenantId: string | null;
  folderId: string | null;
  metadata: Record<string, unknown> | null;
  tags: string[];
  isFavorite: boolean;
  pwnedCount: number;
  expiresAt: string | null;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface SecretDetail extends SecretListItem {
  data: SecretPayload;
  shared?: boolean;
  permission?: 'READ_ONLY' | 'FULL_ACCESS';
}

// --- Input shapes ---

export interface CreateSecretInput {
  name: string;
  description?: string;
  type: SecretType;
  scope: SecretScope;
  teamId?: string;
  folderId?: string;
  data: SecretPayload;
  metadata?: Record<string, unknown>;
  tags?: string[];
  expiresAt?: string;
}

export interface UpdateSecretInput {
  name?: string;
  description?: string | null;
  data?: SecretPayload;
  metadata?: Record<string, unknown> | null;
  tags?: string[];
  folderId?: string | null;
  isFavorite?: boolean;
  expiresAt?: string | null;
  changeNote?: string;
}

// --- Version / share shapes ---

export interface SecretVersion {
  id: string;
  version: number;
  changedBy: string;
  changeNote: string | null;
  createdAt: string;
  changer?: { email: string; username: string | null };
}

export interface SecretShare {
  id: string;
  userId: string;
  email: string;
  permission: 'READ_ONLY' | 'FULL_ACCESS';
  createdAt: string;
}

export interface TenantVaultStatus {
  initialized: boolean;
  hasAccess: boolean;
}

// --- Filter shape ---

export interface SecretListFilters {
  scope?: SecretScope;
  type?: SecretType;
  teamId?: string;
  folderId?: string | null;
  search?: string;
  tags?: string[];
  isFavorite?: boolean;
}

// --- API functions ---

export async function listSecrets(filters?: SecretListFilters): Promise<SecretListItem[]> {
  const params: Record<string, string> = {};
  if (filters?.scope) params.scope = filters.scope;
  if (filters?.type) params.type = filters.type;
  if (filters?.teamId) params.teamId = filters.teamId;
  if (filters?.folderId !== undefined && filters.folderId !== null) params.folderId = filters.folderId;
  if (filters?.search) params.search = filters.search;
  if (filters?.isFavorite !== undefined) params.isFavorite = String(filters.isFavorite);
  if (filters?.tags?.length) params.tags = filters.tags.join(',');
  const { data } = await api.get('/secrets', { params });
  return data;
}

export async function getSecret(id: string): Promise<SecretDetail> {
  const { data } = await api.get(`/secrets/${id}`);
  return data;
}

export async function createSecret(input: CreateSecretInput): Promise<SecretListItem> {
  const { data } = await api.post('/secrets', input);
  return data;
}

export async function updateSecret(id: string, input: UpdateSecretInput): Promise<SecretListItem> {
  const { data } = await api.put(`/secrets/${id}`, input);
  return data;
}

export async function deleteSecret(id: string): Promise<{ deleted: true }> {
  const { data } = await api.delete(`/secrets/${id}`);
  return data;
}

export async function listVersions(id: string): Promise<SecretVersion[]> {
  const { data } = await api.get(`/secrets/${id}/versions`);
  return data;
}

export async function getSecretVersionData(id: string, version: number): Promise<SecretPayload> {
  const { data } = await api.get(`/secrets/${id}/versions/${version}/data`);
  return data.data;
}

export async function restoreVersion(id: string, version: number): Promise<SecretListItem> {
  const { data } = await api.post(`/secrets/${id}/versions/${version}/restore`);
  return data;
}

export async function shareSecret(
  id: string,
  target: { email?: string; userId?: string },
  permission: 'READ_ONLY' | 'FULL_ACCESS',
): Promise<SecretShare> {
  const { data } = await api.post(`/secrets/${id}/share`, { ...target, permission });
  return data;
}

export async function unshareSecret(id: string, userId: string): Promise<{ deleted: true }> {
  const { data } = await api.delete(`/secrets/${id}/share/${userId}`);
  return data;
}

export async function updateSharePermission(
  id: string,
  userId: string,
  permission: 'READ_ONLY' | 'FULL_ACCESS',
): Promise<SecretShare> {
  const { data } = await api.put(`/secrets/${id}/share/${userId}`, { permission });
  return data;
}

export async function listShares(id: string): Promise<SecretShare[]> {
  const { data } = await api.get(`/secrets/${id}/shares`);
  return data;
}

export async function initTenantVault(): Promise<{ initialized: true }> {
  const { data } = await api.post('/secrets/tenant-vault/init');
  return data;
}

export async function distributeTenantKey(targetUserId: string): Promise<{ distributed: true }> {
  const { data } = await api.post('/secrets/tenant-vault/distribute', { targetUserId });
  return data;
}

export async function getTenantVaultStatus(): Promise<TenantVaultStatus> {
  const { data } = await api.get('/secrets/tenant-vault/status');
  return data;
}

// --- Breach check types ---

export interface BreachCheckResult {
  pwnedCount: number;
}

export interface BatchBreachCheckResult {
  checked: number;
  pwned: number;
  results: Array<{ id: string; name: string; pwnedCount: number }>;
}

// --- Breach check API ---

export async function checkSecretBreach(secretId: string): Promise<BreachCheckResult> {
  const { data } = await api.post(`/secrets/${secretId}/breach-check`);
  return data;
}

export async function checkAllSecretBreaches(): Promise<BatchBreachCheckResult> {
  const { data } = await api.post('/secrets/breach-check');
  return data;
}

// --- External share types ---

export interface ExternalShareResult {
  id: string;
  shareUrl: string;
  expiresAt: string;
  maxAccessCount: number | null;
  hasPin: boolean;
}

export interface ExternalShareInfo {
  id: string;
  secretName: string;
  secretType: SecretType;
  hasPin: boolean;
  expiresAt: string;
  isExpired: boolean;
  isExhausted: boolean;
  isRevoked: boolean;
}

export interface ExternalShareListItem {
  id: string;
  secretName: string;
  secretType: SecretType;
  hasPin: boolean;
  expiresAt: string;
  maxAccessCount: number | null;
  accessCount: number;
  isRevoked: boolean;
  createdAt: string;
}

export interface ExternalShareAccessResult {
  secretName: string;
  secretType: SecretType;
  data: SecretPayload;
}

export interface CreateExternalShareInput {
  expiresInMinutes: number;
  maxAccessCount?: number;
  pin?: string;
}

// --- External share API (authenticated) ---

export async function createExternalShare(
  secretId: string,
  input: CreateExternalShareInput,
): Promise<ExternalShareResult> {
  const { data } = await api.post(`/secrets/${secretId}/external-shares`, input);
  return data;
}

export async function listExternalShares(secretId: string): Promise<ExternalShareListItem[]> {
  const { data } = await api.get(`/secrets/${secretId}/external-shares`);
  return data;
}

export async function revokeExternalShare(shareId: string): Promise<{ revoked: true }> {
  const { data } = await api.delete(`/secrets/external-shares/${shareId}`);
  return data;
}

// --- Password rotation API ---

export interface RotationStatusResult {
  enabled: boolean;
  intervalDays: number;
  lastRotatedAt: string | null;
  nextRotationAt: string | null;
}

export interface RotationHistoryEntry {
  id: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  trigger: 'SCHEDULED' | 'CHECKIN' | 'MANUAL';
  targetOS: 'LINUX' | 'WINDOWS';
  targetHost: string;
  targetUser: string;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: string;
}

export interface RotationResult {
  success: boolean;
  secretId: string;
  logId: string;
  error?: string;
}

export async function enableRotation(
  secretId: string,
  intervalDays?: number,
): Promise<{ enabled: true; intervalDays: number }> {
  const { data } = await api.post(`/secrets/${secretId}/rotation/enable`, { intervalDays });
  return data;
}

export async function disableRotation(secretId: string): Promise<{ enabled: false }> {
  const { data } = await api.post(`/secrets/${secretId}/rotation/disable`);
  return data;
}

export async function triggerRotation(secretId: string): Promise<RotationResult> {
  const { data } = await api.post(`/secrets/${secretId}/rotation/trigger`);
  return data;
}

export async function getRotationStatus(secretId: string): Promise<RotationStatusResult> {
  const { data } = await api.get(`/secrets/${secretId}/rotation/status`);
  return data;
}

export async function getRotationHistory(
  secretId: string,
  limit?: number,
): Promise<RotationHistoryEntry[]> {
  const params = limit ? { limit: String(limit) } : {};
  const { data } = await api.get(`/secrets/${secretId}/rotation/history`, { params });
  return data;
}

// --- External share API (public, no auth) ---

const publicApi = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

export async function getExternalShareInfo(token: string): Promise<ExternalShareInfo> {
  const { data } = await publicApi.get(`/share/${token}/info`);
  return data;
}

export async function accessExternalShare(
  token: string,
  pin?: string,
): Promise<ExternalShareAccessResult> {
  const { data } = await publicApi.post(`/share/${token}`, { pin });
  return data;
}
