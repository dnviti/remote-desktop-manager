/**
 * Extension authentication utilities.
 *
 * All API calls are routed through the background service worker via
 * chrome.runtime.sendMessage — popup/options pages never call fetch() directly.
 */

import { sendMessage } from './apiClient';
import type {
  BackgroundResponse,
  LoginResponse,
  LoginResult,
  LoginMfaRequired,
  LoginMfaSetupRequired,
  PendingAccount,
  TenantMembership,
} from '../types';

// ── Type guards ────────────────────────────────────────────────────────

export function isLoginSuccess(res: LoginResponse): res is LoginResult {
  return 'accessToken' in res && 'user' in res;
}

export function isMfaRequired(res: LoginResponse): res is LoginMfaRequired {
  return 'requiresMFA' in res && (res as LoginMfaRequired).requiresMFA === true;
}

export function isMfaSetupRequired(res: LoginResponse): res is LoginMfaSetupRequired {
  return 'mfaSetupRequired' in res && (res as LoginMfaSetupRequired).mfaSetupRequired === true;
}

// ── Login ──────────────────────────────────────────────────────────────

/**
 * Initiate login. Returns the raw server response which may be a success,
 * an MFA challenge, or an MFA setup requirement.
 */
export function login(
  serverUrl: string,
  email: string,
  password: string,
): Promise<BackgroundResponse<LoginResponse>> {
  return sendMessage<LoginResponse>({ type: 'LOGIN', serverUrl, email, password });
}

// ── MFA verification ───────────────────────────────────────────────────

export function verifyTotp(
  serverUrl: string,
  tempToken: string,
  code: string,
  pendingAccount: PendingAccount,
): Promise<BackgroundResponse<LoginResult>> {
  return sendMessage<LoginResult>({
    type: 'VERIFY_TOTP',
    serverUrl,
    tempToken,
    code,
    pendingAccount,
  });
}

export function requestSmsCode(
  serverUrl: string,
  tempToken: string,
): Promise<BackgroundResponse> {
  return sendMessage({ type: 'REQUEST_SMS_CODE', serverUrl, tempToken });
}

export function verifySms(
  serverUrl: string,
  tempToken: string,
  code: string,
  pendingAccount: PendingAccount,
): Promise<BackgroundResponse<LoginResult>> {
  return sendMessage<LoginResult>({
    type: 'VERIFY_SMS',
    serverUrl,
    tempToken,
    code,
    pendingAccount,
  });
}

export function requestWebAuthnOptions(
  serverUrl: string,
  tempToken: string,
): Promise<BackgroundResponse<Record<string, unknown>>> {
  return sendMessage<Record<string, unknown>>({
    type: 'REQUEST_WEBAUTHN_OPTIONS',
    serverUrl,
    tempToken,
  });
}

export function verifyWebAuthn(
  serverUrl: string,
  tempToken: string,
  credential: Record<string, unknown>,
  pendingAccount: PendingAccount,
): Promise<BackgroundResponse<LoginResult>> {
  return sendMessage<LoginResult>({
    type: 'VERIFY_WEBAUTHN',
    serverUrl,
    tempToken,
    credential,
    pendingAccount,
  });
}

// ── Tenant switching ───────────────────────────────────────────────────

export function switchTenant(
  accountId: string,
  tenantId: string,
): Promise<BackgroundResponse<{ accessToken: string; user: LoginResult['user'] }>> {
  return sendMessage<{ accessToken: string; user: LoginResult['user'] }>({
    type: 'SWITCH_TENANT',
    accountId,
    tenantId,
  });
}

// ── Logout ─────────────────────────────────────────────────────────────

export function logoutAccount(accountId: string): Promise<BackgroundResponse> {
  return sendMessage({ type: 'LOGOUT_ACCOUNT', accountId });
}

// ── Token refresh scheduling ───────────────────────────────────────────

/**
 * Parse a JWT access token and return its expiration timestamp (ms).
 * Returns 0 if the token cannot be decoded.
 */
export function getTokenExpiry(token: string): number {
  try {
    const payload = token.split('.')[1];
    if (!payload) return 0;
    const decoded = JSON.parse(atob(payload)) as { exp?: number };
    return decoded.exp ? decoded.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/**
 * Schedule a chrome.alarms alarm that fires 60 seconds before the access
 * token expires, triggering an automatic refresh in the service worker.
 */
export function scheduleTokenRefresh(accountId: string, accessToken: string): void {
  const expiry = getTokenExpiry(accessToken);
  if (expiry === 0) return;

  const fireAt = expiry - 60_000; // 60s before expiry
  const delayMs = Math.max(fireAt - Date.now(), 5_000); // at least 5s

  chrome.alarms.create(`token-refresh-${accountId}`, {
    delayInMinutes: delayMs / 60_000,
  });
}

// Re-export types for convenience
export type { LoginResponse, LoginResult, LoginMfaRequired, LoginMfaSetupRequired, TenantMembership, PendingAccount };
