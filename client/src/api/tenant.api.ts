import api from './client';
import type { TenantRole } from '../utils/roles';
import type { SshTerminalConfig } from '../constants/terminalThemes';
import type { RdpSettings } from '../constants/rdpDefaults';
import type { VncSettings } from '../constants/vncDefaults';

export interface EnforcedConnectionSettings {
  ssh?: Partial<SshTerminalConfig>;
  rdp?: Partial<RdpSettings>;
  vnc?: Partial<VncSettings>;
}

export interface TenantData {
  id: string;
  name: string;
  slug: string;
  mfaRequired: boolean;
  vaultAutoLockMaxMinutes: number | null;
  userCount: number;
  defaultSessionTimeoutSeconds: number;
  dlpDisableCopy: boolean;
  dlpDisablePaste: boolean;
  dlpDisableDownload: boolean;
  dlpDisableUpload: boolean;
  enforcedConnectionSettings?: EnforcedConnectionSettings | null;
  teamCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TenantUser {
  id: string;
  email: string;
  username: string | null;
  avatarData: string | null;
  role: string;
  totpEnabled: boolean;
  smsMfaEnabled: boolean;
  enabled: boolean;
  createdAt: string;
  expiresAt: string | null;
  expired: boolean;
}

export interface TenantMembership {
  tenantId: string;
  name: string;
  slug: string;
  role: string;
  isActive: boolean;
  joinedAt: string;
}

export interface CreateUserData {
  email: string;
  username?: string;
  password: string;
  role: TenantRole;
  sendWelcomeEmail?: boolean;
  expiresAt?: string;
}

export interface CreateUserResult {
  user: {
    id: string;
    email: string;
    username: string | null;
    role: string;
    createdAt: string;
  };
  recoveryKey: string;
}

export interface InviteResult {
  userId: string;
  email: string;
  username: string | null;
  role: string;
}

export interface CreateTenantResponse {
  tenant: TenantData;
  accessToken: string;
  csrfToken: string;
  user: { id: string; email: string; username: string | null; avatarData: string | null; tenantId?: string; tenantRole?: string };
}

export async function createTenant(name: string): Promise<CreateTenantResponse> {
  const { data } = await api.post('/tenants', { name });
  return data;
}

export async function getMyTenant(): Promise<TenantData> {
  const { data } = await api.get('/tenants/mine');
  return data;
}

export async function getTenantMfaStats(tenantId: string): Promise<{ total: number; withoutMfa: number }> {
  const { data } = await api.get(`/tenants/${tenantId}/mfa-stats`);
  return data;
}

export async function updateTenant(id: string, payload: { name?: string; defaultSessionTimeoutSeconds?: number; mfaRequired?: boolean; vaultAutoLockMaxMinutes?: number | null; dlpDisableCopy?: boolean; dlpDisablePaste?: boolean; dlpDisableDownload?: boolean; dlpDisableUpload?: boolean; enforcedConnectionSettings?: EnforcedConnectionSettings | null }): Promise<TenantData> {
  const { data } = await api.put(`/tenants/${id}`, payload);
  return data;
}

export async function deleteTenant(id: string): Promise<{ deleted: boolean }> {
  const { data } = await api.delete(`/tenants/${id}`);
  return data;
}

export interface UserProfileData {
  id: string;
  username: string | null;
  avatarData: string | null;
  role: string;
  joinedAt: string;
  teams: { id: string; name: string; role: string }[];
  // Admin-only fields (present only for OWNER/ADMIN viewers)
  email?: string;
  totpEnabled?: boolean;
  smsMfaEnabled?: boolean;
  webauthnEnabled?: boolean;
  updatedAt?: string;
  lastActivity?: string | null;
}

export async function getUserProfile(tenantId: string, userId: string): Promise<UserProfileData> {
  const { data } = await api.get(`/tenants/${tenantId}/users/${userId}/profile`);
  return data;
}

export async function listTenantUsers(tenantId: string): Promise<TenantUser[]> {
  const { data } = await api.get(`/tenants/${tenantId}/users`);
  return data;
}

export async function inviteUser(
  tenantId: string,
  email: string,
  role: TenantRole,
  expiresAt?: string,
): Promise<InviteResult> {
  const { data } = await api.post(`/tenants/${tenantId}/invite`, { email, role, ...(expiresAt && { expiresAt }) });
  return data;
}

export async function updateUserRole(
  tenantId: string,
  userId: string,
  role: TenantRole,
): Promise<TenantUser> {
  const { data } = await api.put(`/tenants/${tenantId}/users/${userId}`, { role });
  return data;
}

export async function removeUser(
  tenantId: string,
  userId: string,
): Promise<{ removed: boolean }> {
  const { data } = await api.delete(`/tenants/${tenantId}/users/${userId}`);
  return data;
}

export async function createTenantUser(
  tenantId: string,
  payload: CreateUserData,
): Promise<CreateUserResult> {
  const { data } = await api.post(`/tenants/${tenantId}/users`, payload);
  return data;
}

export async function toggleUserEnabled(
  tenantId: string,
  userId: string,
  enabled: boolean,
): Promise<TenantUser> {
  const { data } = await api.patch(`/tenants/${tenantId}/users/${userId}/enabled`, { enabled });
  return data;
}

export async function adminChangeUserEmail(
  tenantId: string,
  userId: string,
  newEmail: string,
  verificationId: string,
): Promise<{ id: string; email: string }> {
  const { data } = await api.put(`/tenants/${tenantId}/users/${userId}/email`, { newEmail, verificationId });
  return data;
}

export async function getMyTenants(): Promise<TenantMembership[]> {
  const { data } = await api.get('/tenants/mine/all');
  return data;
}

export async function switchTenant(tenantId: string): Promise<{
  accessToken: string;
  csrfToken: string;
  user: { id: string; email: string; username: string | null; avatarData: string | null; tenantId?: string; tenantRole?: string };
}> {
  const { data } = await api.post('/auth/switch-tenant', { tenantId });
  return data;
}

export async function adminChangeUserPassword(
  tenantId: string,
  userId: string,
  newPassword: string,
  verificationId: string,
): Promise<{ recoveryKey: string }> {
  const { data } = await api.put(`/tenants/${tenantId}/users/${userId}/password`, { newPassword, verificationId });
  return data;
}

export async function updateMembershipExpiry(
  tenantId: string,
  userId: string,
  expiresAt: string | null,
): Promise<void> {
  await api.patch(`/tenants/${tenantId}/users/${userId}/expiry`, { expiresAt });
}

export interface IpAllowlistData {
  enabled: boolean;
  mode: 'flag' | 'block';
  entries: string[];
}

export async function getIpAllowlist(tenantId: string): Promise<IpAllowlistData> {
  const { data } = await api.get<IpAllowlistData>(`/tenants/${tenantId}/ip-allowlist`);
  return data;
}

export async function updateIpAllowlist(tenantId: string, payload: IpAllowlistData): Promise<IpAllowlistData> {
  const { data } = await api.put<IpAllowlistData>(`/tenants/${tenantId}/ip-allowlist`, payload);
  return data;
}
