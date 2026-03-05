import api from './client';

export interface VaultStatusResponse {
  unlocked: boolean;
  mfaUnlockAvailable: boolean;
  mfaUnlockMethods: string[];
}

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
  return res.data as VaultStatusResponse;
}

export async function revealPassword(connectionId: string, password?: string) {
  const res = await api.post('/vault/reveal-password', { connectionId, password });
  return res.data as { password: string };
}

// MFA-based vault unlock

export async function unlockVaultWithTotp(code: string) {
  const res = await api.post('/vault/unlock-mfa/totp', { code });
  return res.data as { unlocked: boolean };
}

export async function requestVaultWebAuthnOptions() {
  const res = await api.post('/vault/unlock-mfa/webauthn-options');
  return res.data;
}

export async function unlockVaultWithWebAuthn(credential: unknown) {
  const res = await api.post('/vault/unlock-mfa/webauthn', { credential });
  return res.data as { unlocked: boolean };
}

export async function requestVaultSmsCode() {
  const res = await api.post('/vault/unlock-mfa/request-sms');
  return res.data as { sent: boolean };
}

export async function unlockVaultWithSms(code: string) {
  const res = await api.post('/vault/unlock-mfa/sms', { code });
  return res.data as { unlocked: boolean };
}

// Vault auto-lock preference

export interface VaultAutoLockResponse {
  autoLockMinutes: number | null;
  effectiveMinutes: number;
  tenantMaxMinutes: number | null;
}

export async function getVaultAutoLock() {
  const res = await api.get('/vault/auto-lock');
  return res.data as VaultAutoLockResponse;
}

export async function setVaultAutoLock(autoLockMinutes: number | null) {
  const res = await api.put('/vault/auto-lock', { autoLockMinutes });
  return res.data as VaultAutoLockResponse;
}
