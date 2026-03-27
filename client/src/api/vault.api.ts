import api from './client';

export interface VaultStatusResponse {
  unlocked: boolean;
  vaultNeedsRecovery: boolean;
  mfaUnlockAvailable: boolean;
  mfaUnlockMethods: string[];
}

export async function unlockVault(password: string) {
  const { data } = await api.post('/vault/unlock', { password });
  return data as { unlocked: boolean };
}

export async function lockVault() {
  const { data } = await api.post('/vault/lock');
  return data as { unlocked: boolean };
}

export async function getVaultStatus() {
  const { data } = await api.get('/vault/status');
  return data as VaultStatusResponse;
}

// MFA-based vault unlock

export async function unlockVaultWithTotp(code: string) {
  const { data } = await api.post('/vault/unlock-mfa/totp', { code });
  return data as { unlocked: boolean };
}

export async function requestVaultWebAuthnOptions() {
  const { data } = await api.post('/vault/unlock-mfa/webauthn-options');
  return data;
}

export async function unlockVaultWithWebAuthn(credential: unknown) {
  const { data } = await api.post('/vault/unlock-mfa/webauthn', { credential });
  return data as { unlocked: boolean };
}

export async function requestVaultSmsCode() {
  const { data } = await api.post('/vault/unlock-mfa/request-sms');
  return data as { sent: boolean };
}

export async function unlockVaultWithSms(code: string) {
  const { data } = await api.post('/vault/unlock-mfa/sms', { code });
  return data as { unlocked: boolean };
}

// Vault auto-lock preference

export interface VaultAutoLockResponse {
  autoLockMinutes: number | null;
  effectiveMinutes: number;
  tenantMaxMinutes: number | null;
}

export async function getVaultAutoLock() {
  const { data } = await api.get('/vault/auto-lock');
  return data as VaultAutoLockResponse;
}

export async function setVaultAutoLock(autoLockMinutes: number | null) {
  const { data } = await api.put('/vault/auto-lock', { autoLockMinutes });
  return data as VaultAutoLockResponse;
}

// Vault recovery (after password reset)

export interface VaultRecoveryStatusResponse {
  needsRecovery: boolean;
  hasRecoveryKey: boolean;
}

export async function getVaultRecoveryStatus() {
  const { data } = await api.get('/vault/recovery-status');
  return data as VaultRecoveryStatusResponse;
}

export async function recoverVaultWithKey(recoveryKey: string, password: string) {
  const { data } = await api.post('/vault/recover-with-key', { recoveryKey, password });
  return data as { success: boolean; newRecoveryKey: string };
}

export async function explicitVaultReset(password: string) {
  const { data } = await api.post('/vault/explicit-reset', { password, confirmReset: true });
  return data as { success: boolean; newRecoveryKey: string };
}
