import api from './client';

export interface ShareData {
  id: string;
  userId: string;
  email: string;
  permission: 'READ_ONLY' | 'FULL_ACCESS';
  createdAt: string;
}

export async function shareConnection(
  connectionId: string,
  email: string,
  permission: 'READ_ONLY' | 'FULL_ACCESS'
) {
  const res = await api.post(`/connections/${connectionId}/share`, { email, permission });
  return res.data;
}

export async function unshareConnection(connectionId: string, userId: string) {
  const res = await api.delete(`/connections/${connectionId}/share/${userId}`);
  return res.data;
}

export async function updateSharePermission(
  connectionId: string,
  userId: string,
  permission: 'READ_ONLY' | 'FULL_ACCESS'
) {
  const res = await api.put(`/connections/${connectionId}/share/${userId}`, { permission });
  return res.data;
}

export async function listShares(connectionId: string): Promise<ShareData[]> {
  const res = await api.get(`/connections/${connectionId}/shares`);
  return res.data;
}

export async function createSession(connectionId: string) {
  const res = await api.post('/sessions/rdp', { connectionId });
  return res.data as { token: string } | { connectionId: string; type: string };
}

export async function createSshSession(connectionId: string) {
  const res = await api.post('/sessions/ssh', { connectionId });
  return res.data;
}
