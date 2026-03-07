import api from './client';
import type { SshTerminalConfig } from '../constants/terminalThemes';
import type { RdpSettings } from '../constants/rdpDefaults';

export interface ConnectionInput {
  name: string;
  type: 'RDP' | 'SSH';
  host: string;
  port: number;
  username?: string;
  password?: string;
  domain?: string;
  credentialSecretId?: string;
  description?: string;
  folderId?: string;
  teamId?: string;
  enableDrive?: boolean;
  gatewayId?: string | null;
  sshTerminalConfig?: Partial<SshTerminalConfig>;
  rdpSettings?: Partial<RdpSettings>;
  defaultCredentialMode?: 'saved' | 'domain' | 'prompt' | null;
}

export interface ConnectionData {
  id: string;
  name: string;
  type: 'RDP' | 'SSH';
  host: string;
  port: number;
  folderId: string | null;
  teamId?: string | null;
  teamName?: string | null;
  teamRole?: string | null;
  scope?: 'private' | 'team' | 'shared';
  credentialSecretId?: string | null;
  credentialSecretName?: string | null;
  credentialSecretType?: string | null;
  description: string | null;
  isFavorite: boolean;
  enableDrive: boolean;
  gatewayId?: string | null;
  sshTerminalConfig?: Partial<SshTerminalConfig> | null;
  rdpSettings?: Partial<RdpSettings> | null;
  defaultCredentialMode?: 'saved' | 'domain' | 'prompt' | null;
  isOwner: boolean;
  permission?: string;
  sharedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionsResponse {
  own: ConnectionData[];
  shared: ConnectionData[];
  team: ConnectionData[];
}

export async function listConnections(): Promise<ConnectionsResponse> {
  const res = await api.get('/connections');
  return res.data;
}

export async function createConnection(data: ConnectionInput): Promise<ConnectionData> {
  const res = await api.post('/connections', data);
  return res.data;
}

export interface ConnectionUpdate {
  name?: string;
  type?: 'RDP' | 'SSH';
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  domain?: string;
  credentialSecretId?: string | null;
  description?: string | null;
  folderId?: string | null;
  enableDrive?: boolean;
  gatewayId?: string | null;
  sshTerminalConfig?: Partial<SshTerminalConfig> | null;
  rdpSettings?: Partial<RdpSettings> | null;
  defaultCredentialMode?: 'saved' | 'domain' | 'prompt' | null;
}

export async function updateConnection(
  id: string,
  data: ConnectionUpdate
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

export async function toggleFavorite(id: string): Promise<{ id: string; isFavorite: boolean }> {
  const res = await api.patch(`/connections/${id}/favorite`);
  return res.data;
}
