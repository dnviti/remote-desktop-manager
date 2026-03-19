import api from './client';
import type { SshTerminalConfig } from '../constants/terminalThemes';
import type { RdpSettings } from '../constants/rdpDefaults';
import type { VncSettings } from '../constants/vncDefaults';

export interface DlpPolicy {
  disableCopy?: boolean;
  disablePaste?: boolean;
  disableDownload?: boolean;
  disableUpload?: boolean;
}

export interface ResolvedDlpPolicy {
  disableCopy: boolean;
  disablePaste: boolean;
  disableDownload: boolean;
  disableUpload: boolean;
}

export type DbProtocol = 'postgresql' | 'mysql' | 'mongodb';

export interface DbSettings {
  protocol: DbProtocol;
  databaseName?: string;
}

export interface ConnectionInput {
  name: string;
  type: 'RDP' | 'SSH' | 'VNC' | 'DATABASE';
  host: string;
  port: number;
  username?: string;
  password?: string;
  domain?: string;
  credentialSecretId?: string;
  externalVaultProviderId?: string | null;
  externalVaultPath?: string | null;
  description?: string;
  folderId?: string;
  teamId?: string;
  enableDrive?: boolean;
  gatewayId?: string | null;
  sshTerminalConfig?: Partial<SshTerminalConfig>;
  rdpSettings?: Partial<RdpSettings>;
  vncSettings?: Partial<VncSettings>;
  dbSettings?: DbSettings;
  defaultCredentialMode?: 'saved' | 'domain' | 'prompt' | null;
  dlpPolicy?: DlpPolicy | null;
}

export interface ConnectionData {
  id: string;
  name: string;
  type: 'RDP' | 'SSH' | 'VNC' | 'DATABASE';
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
  externalVaultProviderId?: string | null;
  externalVaultPath?: string | null;
  description: string | null;
  isFavorite: boolean;
  enableDrive: boolean;
  gatewayId?: string | null;
  sshTerminalConfig?: Partial<SshTerminalConfig> | null;
  rdpSettings?: Partial<RdpSettings> | null;
  vncSettings?: Partial<VncSettings> | null;
  dbSettings?: DbSettings | null;
  defaultCredentialMode?: 'saved' | 'domain' | 'prompt' | null;
  dlpPolicy?: DlpPolicy | null;
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
  const { data } = await api.get('/connections');
  return data;
}

export async function createConnection(payload: ConnectionInput): Promise<ConnectionData> {
  const { data } = await api.post('/connections', payload);
  return data;
}

export interface ConnectionUpdate {
  name?: string;
  type?: 'RDP' | 'SSH' | 'VNC' | 'DATABASE';
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  domain?: string;
  credentialSecretId?: string | null;
  externalVaultProviderId?: string | null;
  externalVaultPath?: string | null;
  description?: string | null;
  folderId?: string | null;
  enableDrive?: boolean;
  gatewayId?: string | null;
  sshTerminalConfig?: Partial<SshTerminalConfig> | null;
  rdpSettings?: Partial<RdpSettings> | null;
  vncSettings?: Partial<VncSettings> | null;
  dbSettings?: DbSettings | null;
  defaultCredentialMode?: 'saved' | 'domain' | 'prompt' | null;
  dlpPolicy?: DlpPolicy | null;
}

export async function updateConnection(
  id: string,
  payload: ConnectionUpdate
): Promise<ConnectionData> {
  const { data } = await api.put(`/connections/${id}`, payload);
  return data;
}

export async function deleteConnection(id: string) {
  const { data } = await api.delete(`/connections/${id}`);
  return data;
}

export async function getConnection(id: string): Promise<ConnectionData> {
  const { data } = await api.get(`/connections/${id}`);
  return data;
}

export async function toggleFavorite(id: string): Promise<{ id: string; isFavorite: boolean }> {
  const { data } = await api.patch(`/connections/${id}/favorite`);
  return data;
}
