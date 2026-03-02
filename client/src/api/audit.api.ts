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
  | 'TENANT_VAULT_INIT' | 'TENANT_VAULT_KEY_DISTRIBUTE';

export interface AuditLogEntry {
  id: string;
  action: AuditAction;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
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
}

export async function getAuditLogs(params: AuditLogParams = {}): Promise<AuditLogResponse> {
  const res = await api.get('/audit', { params });
  return res.data;
}
