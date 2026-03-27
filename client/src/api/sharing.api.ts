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
  target: { email?: string; userId?: string },
  permission: 'READ_ONLY' | 'FULL_ACCESS'
) {
  const { data } = await api.post(`/connections/${connectionId}/share`, { ...target, permission });
  return data;
}

export async function unshareConnection(connectionId: string, userId: string) {
  const { data } = await api.delete(`/connections/${connectionId}/share/${userId}`);
  return data;
}

export async function listShares(connectionId: string): Promise<ShareData[]> {
  const { data } = await api.get(`/connections/${connectionId}/shares`);
  return data;
}

export interface BatchShareResult {
  shared: number;
  failed: number;
  alreadyShared: number;
  errors: Array<{ connectionId: string; reason: string }>;
}

export async function batchShareConnections(
  connectionIds: string[],
  target: { email?: string; userId?: string },
  permission: 'READ_ONLY' | 'FULL_ACCESS',
  folderName?: string
): Promise<BatchShareResult> {
  const { data } = await api.post('/connections/batch-share', { connectionIds, target, permission, folderName });
  return data;
}

