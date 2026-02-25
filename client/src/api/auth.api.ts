import api from './client';

export async function loginApi(email: string, password: string) {
  const res = await api.post('/auth/login', { email, password });
  return res.data as {
    accessToken: string;
    refreshToken: string;
    user: { id: string; email: string };
  };
}

export async function registerApi(email: string, password: string) {
  const res = await api.post('/auth/register', { email, password });
  return res.data;
}

export async function refreshApi(refreshToken: string) {
  const res = await api.post('/auth/refresh', { refreshToken });
  return res.data as { accessToken: string };
}

export async function logoutApi(refreshToken: string) {
  await api.post('/auth/logout', { refreshToken });
}
