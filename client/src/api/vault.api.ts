import api from './client';

export async function unlockVault(password: string) {
  const res = await api.post('/vault/unlock', { password });
  return res.data as { unlocked: boolean };
}

export async function lockVault() {
  const res = await api.post('/vault/lock');
  return res.data as { unlocked: boolean };
}

export async function getVaultStatus() {
  const res = await api.get('/vault/status');
  return res.data as { unlocked: boolean };
}

export async function revealPassword(connectionId: string, password?: string) {
  const res = await api.post('/vault/reveal-password', { connectionId, password });
  return res.data as { password: string };
}
