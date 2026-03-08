import api from './client';
import type { SshTerminalConfig } from '../constants/terminalThemes';
import type { RdpSettings } from '../constants/rdpDefaults';

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

export async function getProfile(): Promise<UserProfile> {
  const res = await api.get('/user/profile');
  return res.data;
}

export async function updateProfile(data: { username?: string }): Promise<UserProfile> {
  const res = await api.put('/user/profile', data);
  return res.data;
}

export async function changePassword(
  oldPassword: string,
  newPassword: string,
  verificationId?: string,
): Promise<{ success: boolean }> {
  const res = await api.put('/user/password', { oldPassword, newPassword, verificationId });
  return res.data;
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
  const res = await api.post('/user/identity/initiate', { purpose });
  return res.data;
}

export async function confirmIdentityVerification(
  verificationId: string,
  payload: { code?: string; credential?: unknown; password?: string },
): Promise<{ confirmed: boolean }> {
  const res = await api.post('/user/identity/confirm', { verificationId, ...payload });
  return res.data;
}

// Email change

export interface EmailChangeInitResult {
  flow: 'dual-otp' | 'identity-verification';
  verificationId?: string;
  method?: VerificationMethod;
  metadata?: Record<string, unknown>;
}

export async function initiateEmailChange(newEmail: string): Promise<EmailChangeInitResult> {
  const res = await api.post('/user/email-change/initiate', { newEmail });
  return res.data;
}

export async function confirmEmailChange(
  data: { codeOld?: string; codeNew?: string; verificationId?: string },
): Promise<{ email: string }> {
  const res = await api.post('/user/email-change/confirm', data);
  return res.data;
}

// Password change initiation

export interface PasswordChangeInitResult {
  skipVerification: boolean;
  verificationId?: string;
  method?: VerificationMethod;
  metadata?: Record<string, unknown>;
}

export async function initiatePasswordChange(): Promise<PasswordChangeInitResult> {
  const res = await api.post('/user/password-change/initiate');
  return res.data;
}

export async function updateSshDefaults(
  data: Partial<SshTerminalConfig>
): Promise<{ id: string; sshDefaults: Partial<SshTerminalConfig> }> {
  const res = await api.put('/user/ssh-defaults', data);
  return res.data;
}

export async function updateRdpDefaults(
  data: Partial<RdpSettings>
): Promise<{ id: string; rdpDefaults: Partial<RdpSettings> }> {
  const res = await api.put('/user/rdp-defaults', data);
  return res.data;
}

export async function uploadAvatar(avatarData: string): Promise<{ id: string; avatarData: string }> {
  const res = await api.post('/user/avatar', { avatarData });
  return res.data;
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
  const res = await api.get('/user/search', { params });
  return res.data;
}

// Domain profile

export interface DomainProfile {
  domainName: string | null;
  domainUsername: string | null;
  hasDomainPassword: boolean;
}

export async function getDomainProfile(): Promise<DomainProfile> {
  const res = await api.get('/user/domain-profile');
  return res.data;
}

export async function updateDomainProfile(data: {
  domainName?: string;
  domainUsername?: string;
  domainPassword?: string | null;
}): Promise<DomainProfile> {
  const res = await api.put('/user/domain-profile', data);
  return res.data;
}

export async function clearDomainProfile(): Promise<{ success: boolean }> {
  const res = await api.delete('/user/domain-profile');
  return res.data;
}
