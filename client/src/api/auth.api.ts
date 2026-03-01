import api from './client';

type UserInfo = { id: string; email: string; username: string | null; avatarData: string | null };

type MfaMethod = 'totp' | 'sms';

export type LoginResponse =
  | { requiresMFA: true; requiresTOTP?: boolean; methods: MfaMethod[]; tempToken: string }
  | { requiresTOTP: true; tempToken: string }
  | { requiresTOTP?: false; accessToken: string; refreshToken: string; user: UserInfo };

export async function loginApi(email: string, password: string): Promise<LoginResponse> {
  const res = await api.post('/auth/login', { email, password });
  return res.data;
}

export async function verifyTotpApi(tempToken: string, code: string) {
  const res = await api.post('/auth/verify-totp', { tempToken, code });
  return res.data as { accessToken: string; refreshToken: string; user: UserInfo };
}

export async function requestSmsCodeApi(tempToken: string) {
  const res = await api.post('/auth/request-sms-code', { tempToken });
  return res.data as { message: string };
}

export async function verifySmsApi(tempToken: string, code: string) {
  const res = await api.post('/auth/verify-sms', { tempToken, code });
  return res.data as { accessToken: string; refreshToken: string; user: UserInfo };
}

export async function registerApi(email: string, password: string) {
  const res = await api.post('/auth/register', { email, password });
  return res.data as { message: string; emailVerifyRequired: boolean };
}

export async function refreshApi(refreshToken: string) {
  const res = await api.post('/auth/refresh', { refreshToken });
  return res.data as {
    accessToken: string;
    user: { id: string; email: string; username: string | null; avatarData: string | null };
  };
}

export async function logoutApi(refreshToken: string) {
  await api.post('/auth/logout', { refreshToken });
}
