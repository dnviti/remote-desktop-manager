import api from './client';

export interface TenantData {
  id: string;
  name: string;
  slug: string;
  mfaRequired: boolean;
  vaultAutoLockMaxMinutes: number | null;
  userCount: number;
  defaultSessionTimeoutSeconds: number;
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
  role: 'ADMIN' | 'MEMBER';
  sendWelcomeEmail?: boolean;
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
  const res = await api.post('/tenants', { name });
  return res.data;
}

export async function getMyTenant(): Promise<TenantData> {
  const res = await api.get('/tenants/mine');
  return res.data;
}

export async function getTenantMfaStats(tenantId: string): Promise<{ total: number; withoutMfa: number }> {
  const res = await api.get(`/tenants/${tenantId}/mfa-stats`);
  return res.data;
}

export async function updateTenant(id: string, data: { name?: string; defaultSessionTimeoutSeconds?: number; mfaRequired?: boolean; vaultAutoLockMaxMinutes?: number | null }): Promise<TenantData> {
  const res = await api.put(`/tenants/${id}`, data);
  return res.data;
}

export async function deleteTenant(id: string): Promise<{ deleted: boolean }> {
  const res = await api.delete(`/tenants/${id}`);
  return res.data;
}

export async function listTenantUsers(tenantId: string): Promise<TenantUser[]> {
  const res = await api.get(`/tenants/${tenantId}/users`);
  return res.data;
}

export async function inviteUser(
  tenantId: string,
  email: string,
  role: 'ADMIN' | 'MEMBER',
): Promise<InviteResult> {
  const res = await api.post(`/tenants/${tenantId}/invite`, { email, role });
  return res.data;
}

export async function updateUserRole(
  tenantId: string,
  userId: string,
  role: 'OWNER' | 'ADMIN' | 'MEMBER',
): Promise<TenantUser> {
  const res = await api.put(`/tenants/${tenantId}/users/${userId}`, { role });
  return res.data;
}

export async function removeUser(
  tenantId: string,
  userId: string,
): Promise<{ removed: boolean }> {
  const res = await api.delete(`/tenants/${tenantId}/users/${userId}`);
  return res.data;
}

export async function createTenantUser(
  tenantId: string,
  data: CreateUserData,
): Promise<CreateUserResult> {
  const res = await api.post(`/tenants/${tenantId}/users`, data);
  return res.data;
}

export async function toggleUserEnabled(
  tenantId: string,
  userId: string,
  enabled: boolean,
): Promise<TenantUser> {
  const res = await api.patch(`/tenants/${tenantId}/users/${userId}/enabled`, { enabled });
  return res.data;
}

export async function adminChangeUserEmail(
  tenantId: string,
  userId: string,
  newEmail: string,
  verificationId: string,
): Promise<{ id: string; email: string }> {
  const res = await api.put(`/tenants/${tenantId}/users/${userId}/email`, { newEmail, verificationId });
  return res.data;
}

export async function getMyTenants(): Promise<TenantMembership[]> {
  const res = await api.get('/tenants/mine/all');
  return res.data;
}

export async function switchTenant(tenantId: string): Promise<{
  accessToken: string;
  csrfToken: string;
  user: { id: string; email: string; username: string | null; avatarData: string | null; tenantId?: string; tenantRole?: string };
}> {
  const res = await api.post('/auth/switch-tenant', { tenantId });
  return res.data;
}

export async function adminChangeUserPassword(
  tenantId: string,
  userId: string,
  newPassword: string,
  verificationId: string,
): Promise<{ recoveryKey: string }> {
  const res = await api.put(`/tenants/${tenantId}/users/${userId}/password`, { newPassword, verificationId });
  return res.data;
}
