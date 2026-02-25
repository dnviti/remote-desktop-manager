import api from './client';

export interface ConnectionInput {
  name: string;
  type: 'RDP' | 'SSH';
  host: string;
  port: number;
  username: string;
  password: string;
  description?: string;
  folderId?: string;
}

export interface ConnectionData {
  id: string;
  name: string;
  type: 'RDP' | 'SSH';
  host: string;
  port: number;
  folderId: string | null;
  description: string | null;
  isOwner: boolean;
  permission?: string;
  sharedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionsResponse {
  own: ConnectionData[];
  shared: ConnectionData[];
}

export async function listConnections(): Promise<ConnectionsResponse> {
  const res = await api.get('/connections');
  return res.data;
}

export async function createConnection(data: ConnectionInput): Promise<ConnectionData> {
  const res = await api.post('/connections', data);
  return res.data;
}

export async function updateConnection(
  id: string,
  data: Partial<ConnectionInput>
): Promise<ConnectionData> {
  const res = await api.put(`/connections/${id}`, data);
  return res.data;
}

export async function deleteConnection(id: string) {
  const res = await api.delete(`/connections/${id}`);
  return res.data;
}

export async function getConnection(id: string): Promise<ConnectionData> {
  const res = await api.get(`/connections/${id}`);
  return res.data;
}
