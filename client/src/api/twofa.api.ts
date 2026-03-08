import api from './client';

export async function setup2FA() {
  const res = await api.post('/user/2fa/setup');
  return res.data as { secret: string; otpauthUri: string };
}

export async function verify2FA(code: string) {
  const res = await api.post('/user/2fa/verify', { code });
  return res.data as { enabled: boolean };
}

export async function disable2FA(code: string) {
  const res = await api.post('/user/2fa/disable', { code });
  return res.data as { enabled: boolean };
}

export async function get2FAStatus() {
  const res = await api.get('/user/2fa/status');
  return res.data as { enabled: boolean };
}
