import api from './client';

type UserInfo = { id: string; email: string; username: string | null; avatarData: string | null };

type MfaMethod = 'totp' | 'sms' | 'webauthn';

export type LoginResponse =
  | { requiresMFA: true; requiresTOTP?: boolean; methods: MfaMethod[]; tempToken: string }
  | { mfaSetupRequired: true; tempToken: string }
  | { requiresTOTP: true; tempToken: string }
  | { requiresTOTP?: false; accessToken: string; csrfToken: string; user: UserInfo };

export async function loginApi(email: string, password: string): Promise<LoginResponse> {
  const res = await api.post('/auth/login', { email, password });
  return res.data;
}

export async function verifyTotpApi(tempToken: string, code: string) {
  const res = await api.post('/auth/verify-totp', { tempToken, code });
  return res.data as { accessToken: string; csrfToken: string; user: UserInfo };
}

export async function requestSmsCodeApi(tempToken: string) {
  const res = await api.post('/auth/request-sms-code', { tempToken });
  return res.data as { message: string };
}

export async function verifySmsApi(tempToken: string, code: string) {
  const res = await api.post('/auth/verify-sms', { tempToken, code });
  return res.data as { accessToken: string; csrfToken: string; user: UserInfo };
}

export async function mfaSetupInitApi(tempToken: string) {
  const res = await api.post('/auth/mfa-setup/init', { tempToken });
  return res.data as { secret: string; otpauthUri: string };
}

export async function mfaSetupVerifyApi(tempToken: string, code: string) {
  const res = await api.post('/auth/mfa-setup/verify', { tempToken, code });
  return res.data as { accessToken: string; csrfToken: string; user: UserInfo };
}

export async function requestWebAuthnOptionsApi(tempToken: string) {
  const res = await api.post('/auth/request-webauthn-options', { tempToken });
  return res.data;
}

export async function verifyWebAuthnApi(tempToken: string, credential: unknown) {
  const res = await api.post('/auth/verify-webauthn', { tempToken, credential });
  return res.data as { accessToken: string; csrfToken: string; user: UserInfo };
}

export async function registerApi(email: string, password: string) {
  const res = await api.post('/auth/register', { email, password });
  return res.data as { message: string; emailVerifyRequired: boolean };
}

export async function refreshApi() {
  const res = await api.post('/auth/refresh');
  return res.data as {
    accessToken: string;
    csrfToken: string;
    user: { id: string; email: string; username: string | null; avatarData: string | null };
  };
}

export async function logoutApi() {
  await api.post('/auth/logout');
}
