import api from './client';
import type { SshTerminalConfig } from '../constants/terminalThemes';
import type { RdpSettings } from '../constants/rdpDefaults';
import type { PermissionFlag } from '../utils/permissionFlags';

export interface UserProfile {
  id: string;
  email: string;
  username: string | null;
  avatarData: string | null;
  sshDefaults: Partial<SshTerminalConfig> | null;
  rdpDefaults: Partial<RdpSettings> | null;
  hasPassword: boolean;
  vaultSetupComplete: boolean;
  oauthAccounts: { id: string; provider: string; providerEmail: string | null }[];
  createdAt: string;
}

export interface CurrentUserPermissions {
  tenantId?: string;
  role?: string;
  permissions: Record<PermissionFlag, boolean>;
}

export async function getProfile(): Promise<UserProfile> {
  const { data } = await api.get('/user/profile');
  return data;
}

export async function getCurrentUserPermissions(): Promise<CurrentUserPermissions> {
  const { data } = await api.get('/user/permissions');
  return data;
}

export async function updateProfile(payload: { username?: string }): Promise<UserProfile> {
  const { data } = await api.put('/user/profile', payload);
  return data;
}

export async function changePassword(
  oldPassword: string,
  newPassword: string,
  verificationId?: string,
): Promise<{ success: boolean; recoveryKey: string }> {
  const { data } = await api.put('/user/password', { oldPassword, newPassword, verificationId });
  return data;
}

// Identity verification

export type VerificationMethod = 'email' | 'totp' | 'sms' | 'webauthn' | 'password';

export interface IdentityInitiateResponse {
  verificationId: string;
  method: VerificationMethod;
  metadata?: Record<string, unknown>;
}

export async function initiateIdentityVerification(
  purpose: string,
): Promise<IdentityInitiateResponse> {
  const { data } = await api.post('/user/identity/initiate', { purpose });
  return data;
}

export async function confirmIdentityVerification(
  verificationId: string,
  payload: { code?: string; credential?: unknown; password?: string },
): Promise<{ confirmed: boolean }> {
  const { data } = await api.post('/user/identity/confirm', { verificationId, ...payload });
  return data;
}

// Email change

export interface EmailChangeInitResult {
  flow: 'dual-otp' | 'identity-verification';
  verificationId?: string;
  method?: VerificationMethod;
  metadata?: Record<string, unknown>;
}

export async function initiateEmailChange(newEmail: string): Promise<EmailChangeInitResult> {
  const { data } = await api.post('/user/email-change/initiate', { newEmail });
  return data;
}

export async function confirmEmailChange(
  payload: { codeOld?: string; codeNew?: string; verificationId?: string },
): Promise<{ email: string }> {
  const { data } = await api.post('/user/email-change/confirm', payload);
  return data;
}

// Password change initiation

export interface PasswordChangeInitResult {
  skipVerification: boolean;
  verificationId?: string;
  method?: VerificationMethod;
  metadata?: Record<string, unknown>;
}

export async function initiatePasswordChange(): Promise<PasswordChangeInitResult> {
  const { data } = await api.post('/user/password-change/initiate');
  return data;
}

export async function updateSshDefaults(
  payload: Partial<SshTerminalConfig>
): Promise<{ id: string; sshDefaults: Partial<SshTerminalConfig> }> {
  const { data } = await api.put('/user/ssh-defaults', payload);
  return data;
}

export async function updateRdpDefaults(
  payload: Partial<RdpSettings>
): Promise<{ id: string; rdpDefaults: Partial<RdpSettings> }> {
  const { data } = await api.put('/user/rdp-defaults', payload);
  return data;
}

export async function uploadAvatar(avatarData: string): Promise<{ id: string; avatarData: string }> {
  const { data } = await api.post('/user/avatar', { avatarData });
  return data;
}

export interface UserSearchResult {
  id: string;
  email: string;
  username: string | null;
  avatarData: string | null;
}

export async function searchUsers(
  query: string,
  scope: 'tenant' | 'team' = 'tenant',
  teamId?: string
): Promise<UserSearchResult[]> {
  const params: Record<string, string> = { q: query, scope };
  if (teamId) params.teamId = teamId;
  const { data } = await api.get('/user/search', { params });
  return data;
}

// Domain profile

export interface DomainProfile {
  domainName: string | null;
  domainUsername: string | null;
  hasDomainPassword: boolean;
}

export async function getDomainProfile(): Promise<DomainProfile> {
  const { data } = await api.get('/user/domain-profile');
  return data;
}

export async function updateDomainProfile(payload: {
  domainName?: string;
  domainUsername?: string;
  domainPassword?: string | null;
}): Promise<DomainProfile> {
  const { data } = await api.put('/user/domain-profile', payload);
  return data;
}

export async function clearDomainProfile(): Promise<{ success: boolean }> {
  const { data } = await api.delete('/user/domain-profile');
  return data;
}
