/**
 * Vault API wrappers for the browser extension.
 *
 * All calls route through the background service worker via apiRequest().
 */

import { apiRequest } from './apiClient';
import type { BackgroundResponse, VaultStatusResponse, VaultFoldersResponse } from '../types';

/** Get vault lock status for the given account. */
export function getVaultStatus(
  accountId: string,
): Promise<BackgroundResponse<VaultStatusResponse>> {
  return apiRequest<VaultStatusResponse>(accountId, 'GET', '/api/vault/status');
}

/** Unlock vault with password. */
export function unlockVault(
  accountId: string,
  password: string,
): Promise<BackgroundResponse<{ unlocked: boolean }>> {
  return apiRequest<{ unlocked: boolean }>(accountId, 'POST', '/api/vault/unlock', { password });
}

/** Unlock vault with TOTP code. */
export function unlockVaultWithTotp(
  accountId: string,
  code: string,
): Promise<BackgroundResponse<{ unlocked: boolean }>> {
  return apiRequest<{ unlocked: boolean }>(accountId, 'POST', '/api/vault/unlock-mfa/totp', { code });
}

/** Request SMS code for vault MFA unlock. */
export function requestVaultSmsCode(
  accountId: string,
): Promise<BackgroundResponse<{ sent: boolean }>> {
  return apiRequest<{ sent: boolean }>(accountId, 'POST', '/api/vault/unlock-mfa/request-sms');
}

/** Unlock vault with SMS code. */
export function unlockVaultWithSms(
  accountId: string,
  code: string,
): Promise<BackgroundResponse<{ unlocked: boolean }>> {
  return apiRequest<{ unlocked: boolean }>(accountId, 'POST', '/api/vault/unlock-mfa/sms', { code });
}

/** Lock vault explicitly. */
export function lockVault(
  accountId: string,
): Promise<BackgroundResponse<{ unlocked: boolean }>> {
  return apiRequest<{ unlocked: boolean }>(accountId, 'POST', '/api/vault/lock');
}

/** List vault folders grouped by scope. */
export function listVaultFolders(
  accountId: string,
): Promise<BackgroundResponse<VaultFoldersResponse>> {
  return apiRequest<VaultFoldersResponse>(accountId, 'GET', '/api/vault-folders');
}
