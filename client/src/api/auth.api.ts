import api from './client';

type UserInfo = { id: string; email: string; username: string | null; avatarData: string | null };

type MfaMethod = 'totp' | 'sms' | 'webauthn';
export type TenantMembershipStatus = 'PENDING' | 'ACCEPTED';

export interface TenantMembershipInfo {
  tenantId: string;
  name: string;
  slug: string;
  role: string;
  status: TenantMembershipStatus;
  pending: boolean;
  isActive: boolean;
}

export type AuthSuccessResponse = {
  accessToken: string;
  csrfToken: string;
  user: UserInfo;
  tenantMemberships?: TenantMembershipInfo[];
};

export type LoginResponse =
  | { requiresMFA: true; requiresTOTP?: boolean; methods: MfaMethod[]; tempToken: string }
  | { mfaSetupRequired: true; tempToken: string }
  | { requiresTOTP: true; tempToken: string }
  | (AuthSuccessResponse & { requiresTOTP?: false });

export async function loginApi(email: string, password: string): Promise<LoginResponse> {
  const { data } = await api.post('/auth/login', { email, password });
  return data;
}

export async function verifyTotpApi(tempToken: string, code: string) {
  const { data } = await api.post('/auth/verify-totp', { tempToken, code });
  return data as AuthSuccessResponse;
}

export async function requestSmsCodeApi(tempToken: string) {
  const { data } = await api.post('/auth/request-sms-code', { tempToken });
  return data as { message: string };
}

export async function verifySmsApi(tempToken: string, code: string) {
  const { data } = await api.post('/auth/verify-sms', { tempToken, code });
  return data as AuthSuccessResponse;
}

export async function mfaSetupInitApi(tempToken: string) {
  const { data } = await api.post('/auth/mfa-setup/init', { tempToken });
  return data as { secret: string; otpauthUri: string };
}

export async function mfaSetupVerifyApi(tempToken: string, code: string) {
  const { data } = await api.post('/auth/mfa-setup/verify', { tempToken, code });
  return data as AuthSuccessResponse;
}

export async function requestWebAuthnOptionsApi(tempToken: string) {
  const { data } = await api.post('/auth/request-webauthn-options', { tempToken });
  return data;
}

export async function verifyWebAuthnApi(tempToken: string, credential: unknown, expectedChallenge?: string) {
  const { data } = await api.post('/auth/verify-webauthn', { tempToken, credential, expectedChallenge });
  return data as AuthSuccessResponse;
}

export async function registerApi(email: string, password: string) {
  const { data } = await api.post('/auth/register', { email, password });
  return data as { message: string; emailVerifyRequired: boolean; recoveryKey?: string };
}

export async function refreshApi() {
  const { data } = await api.post('/auth/refresh');
  return data as {
    accessToken: string;
    csrfToken: string;
    user: { id: string; email: string; username: string | null; avatarData: string | null };
  };
}

export async function restoreSessionApi() {
  const { data } = await api.get('/auth/session');
  return data as {
    accessToken: string;
    csrfToken: string;
    user: { id: string; email: string; username: string | null; avatarData: string | null };
  };
}

export async function logoutApi() {
  await api.post('/auth/logout');
}

export interface FeatureFlags {
  databaseProxyEnabled: boolean;
  connectionsEnabled: boolean;
  keychainEnabled: boolean;
  recordingsEnabled: boolean;
  zeroTrustEnabled: boolean;
  agenticAIEnabled: boolean;
  enterpriseAuthEnabled: boolean;
  sharingApprovalsEnabled: boolean;
  cliEnabled: boolean;
  mode: 'development' | 'production';
  backend: 'podman' | 'kubernetes';
  routing: {
    directGateway: boolean;
    zeroTrust: boolean;
  };
}

export interface PublicConfig {
  selfSignupEnabled: boolean;
  features: FeatureFlags;
}

export async function getPublicConfig(): Promise<PublicConfig> {
  const { data } = await api.get<PublicConfig>('/auth/config');
  return data;
}
