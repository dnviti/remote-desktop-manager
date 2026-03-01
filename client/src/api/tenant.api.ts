import api from './client';

export interface TenantData {
  id: string;
  name: string;
  slug: string;
  userCount: number;
  teamCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TenantUser {
  id: string;
  email: string;
  username: string | null;
  avatarData: string | null;
  tenantRole: string;
  createdAt: string;
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
  refreshToken: string;
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

export async function updateTenant(id: string, data: { name?: string }): Promise<TenantData> {
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
