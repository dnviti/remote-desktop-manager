import api from './client';

export type AuditAction =
  | 'LOGIN' | 'LOGIN_OAUTH' | 'LOGIN_TOTP' | 'LOGIN_FAILURE' | 'LOGOUT' | 'REGISTER'
  | 'LOGIN_SMS' | 'SMS_MFA_ENABLE' | 'SMS_MFA_DISABLE' | 'SMS_PHONE_VERIFY'
  | 'VAULT_UNLOCK' | 'VAULT_LOCK' | 'VAULT_SETUP'
  | 'CREATE_CONNECTION' | 'UPDATE_CONNECTION' | 'DELETE_CONNECTION'
  | 'SHARE_CONNECTION' | 'UNSHARE_CONNECTION' | 'UPDATE_SHARE_PERMISSION'
  | 'CREATE_FOLDER' | 'UPDATE_FOLDER' | 'DELETE_FOLDER'
  | 'PASSWORD_CHANGE' | 'PROFILE_UPDATE'
  | 'TOTP_ENABLE' | 'TOTP_DISABLE'
  | 'OAUTH_LINK' | 'OAUTH_UNLINK'
  | 'PASSWORD_REVEAL'
  | 'TENANT_CREATE' | 'TENANT_UPDATE' | 'TENANT_DELETE'
  | 'TENANT_INVITE_USER' | 'TENANT_REMOVE_USER' | 'TENANT_UPDATE_USER_ROLE'
  | 'TEAM_CREATE' | 'TEAM_UPDATE' | 'TEAM_DELETE'
  | 'TEAM_ADD_MEMBER' | 'TEAM_REMOVE_MEMBER' | 'TEAM_UPDATE_MEMBER_ROLE'
  | 'EMAIL_TEST_SEND' | 'BATCH_SHARE'
  | 'GATEWAY_CREATE' | 'GATEWAY_UPDATE' | 'GATEWAY_DELETE'
  | 'SSH_KEY_GENERATE' | 'SSH_KEY_ROTATE' | 'SSH_KEY_PUSH' | 'SSH_KEY_AUTO_ROTATE'
  | 'SESSION_START' | 'SESSION_END'
  | 'SECRET_CREATE' | 'SECRET_READ' | 'SECRET_UPDATE' | 'SECRET_DELETE'
  | 'SECRET_SHARE' | 'SECRET_UNSHARE'
  | 'SECRET_EXTERNAL_SHARE' | 'SECRET_EXTERNAL_ACCESS'
  | 'SECRET_VERSION_RESTORE'
  | 'TENANT_VAULT_INIT' | 'TENANT_VAULT_KEY_DISTRIBUTE' | 'TENANT_MFA_POLICY_UPDATE'
  | 'GATEWAY_DEPLOY' | 'GATEWAY_UNDEPLOY' | 'GATEWAY_SCALE'
  | 'GATEWAY_SCALE_UP' | 'GATEWAY_SCALE_DOWN' | 'GATEWAY_RESTART' | 'GATEWAY_HEALTH_CHECK'
  | 'SESSION_TIMEOUT' | 'SESSION_ERROR'
  | 'GATEWAY_TEMPLATE_CREATE' | 'GATEWAY_TEMPLATE_UPDATE' | 'GATEWAY_TEMPLATE_DELETE' | 'GATEWAY_TEMPLATE_DEPLOY'
  | 'GATEWAY_VIEW_LOGS'
  | 'REFRESH_TOKEN_REUSE'
  | 'SFTP_UPLOAD' | 'SFTP_DOWNLOAD' | 'SFTP_DELETE' | 'SFTP_MKDIR' | 'SFTP_RENAME'
  | 'VAULT_AUTO_LOCK'
  | 'SESSION_TERMINATE'
  | 'SECRET_EXTERNAL_REVOKE'
  | 'SECRET_SHARE_UPDATE'
  | 'GATEWAY_RECONCILE'
  | 'CONNECTION_FAVORITE';

export interface AuditLogEntry {
  id: string;
  action: AuditAction;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  gatewayId: string | null;
  createdAt: string;
}

export interface AuditGateway {
  id: string;
  name: string;
}

export interface AuditLogResponse {
  data: AuditLogEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AuditLogParams {
  page?: number;
  limit?: number;
  action?: AuditAction;
  startDate?: string;
  endDate?: string;
  search?: string;
  targetType?: string;
  ipAddress?: string;
  gatewayId?: string;
  sortBy?: 'createdAt' | 'action';
  sortOrder?: 'asc' | 'desc';
}

export async function getAuditLogs(params: AuditLogParams = {}): Promise<AuditLogResponse> {
  const res = await api.get('/audit', { params });
  return res.data;
}

export async function getAuditGateways(): Promise<AuditGateway[]> {
  const res = await api.get('/audit/gateways');
  return res.data;
}

export interface TenantAuditLogEntry extends AuditLogEntry {
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
}

export interface TenantAuditLogResponse {
  data: TenantAuditLogEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface TenantAuditLogParams extends AuditLogParams {
  userId?: string;
}

export async function getTenantAuditLogs(params: TenantAuditLogParams = {}): Promise<TenantAuditLogResponse> {
  const res = await api.get('/audit/tenant', { params });
  return res.data;
}

export async function getTenantAuditGateways(): Promise<AuditGateway[]> {
  const res = await api.get('/audit/tenant/gateways');
  return res.data;
}

export interface ConnectionAuditUser {
  id: string;
  username: string | null;
  email: string;
}

export interface ConnectionAuditLogParams extends AuditLogParams {
  userId?: string;
}

export async function getConnectionAuditLogs(
  connectionId: string,
  params: ConnectionAuditLogParams = {}
): Promise<TenantAuditLogResponse> {
  const res = await api.get(`/audit/connection/${connectionId}`, { params });
  return res.data;
}

export async function getConnectionAuditUsers(connectionId: string): Promise<ConnectionAuditUser[]> {
  const res = await api.get(`/audit/connection/${connectionId}/users`);
  return res.data;
}
