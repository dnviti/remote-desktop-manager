/**
 * Background service worker — handles ALL API calls to Arsenale servers,
 * bypassing CORS entirely. Popup/options pages communicate via chrome.runtime.sendMessage.
 */

import {
  getAccounts,
  getActiveAccount,
  setActiveAccountId,
  addAccount,
  updateAccount,
  removeAccount,
  touchAccount,
} from './lib/accountStore';
import type {
  BackgroundMessage,
  BackgroundResponse,
  HealthCheckResult,
  LoginResult,
} from './types';

// ── Token refresh alarm ────────────────────────────────────────────────
const REFRESH_ALARM = 'token-refresh';
const REFRESH_INTERVAL_MINUTES = 10;

chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_INTERVAL_MINUTES });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== REFRESH_ALARM) return;
  const account = await getActiveAccount();
  if (!account) return;
  await refreshTokenForAccount(account.id);
});

// ── Message handler ────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener(
  (message: BackgroundMessage, _sender, sendResponse: (response: BackgroundResponse) => void) => {
    handleMessage(message).then(sendResponse);
    // Return true to indicate we will respond asynchronously
    return true;
  },
);

async function handleMessage(message: BackgroundMessage): Promise<BackgroundResponse> {
  switch (message.type) {
    case 'HEALTH_CHECK':
      return handleHealthCheck(message.serverUrl);
    case 'LOGIN':
      return handleLogin(message.serverUrl, message.email, message.password);
    case 'API_REQUEST':
      return handleApiRequest(message.accountId, message.method, message.path, message.body);
    case 'REFRESH_TOKEN':
      return refreshTokenForAccount(message.accountId);
    case 'GET_ACCOUNTS':
      return handleGetAccounts();
    case 'SET_ACTIVE_ACCOUNT':
      return handleSetActiveAccount(message.accountId);
    case 'REMOVE_ACCOUNT':
      return handleRemoveAccount(message.accountId);
    case 'UPDATE_ACCOUNT':
      return handleUpdateAccount(message.account);
    default:
      return { success: false, error: 'Unknown message type' };
  }
}

// ── Handlers ───────────────────────────────────────────────────────────

async function handleHealthCheck(serverUrl: string): Promise<BackgroundResponse<HealthCheckResult>> {
  try {
    const url = normalizeUrl(serverUrl);
    const res = await fetch(`${url}/api/health`, { method: 'GET' });
    if (!res.ok) return { success: false, error: `Server responded with ${String(res.status)}` };
    const data = (await res.json()) as HealthCheckResult;
    return { success: true, data };
  } catch (err) {
    return { success: false, error: formatError(err) };
  }
}

async function handleLogin(
  serverUrl: string,
  email: string,
  password: string,
): Promise<BackgroundResponse<{ accountId: string }>> {
  try {
    const url = normalizeUrl(serverUrl);
    const res = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { success: false, error: body || `Login failed with ${String(res.status)}` };
    }
    const data = (await res.json()) as LoginResult;
    const account = await addAccount({
      label: data.user.name || data.user.email,
      serverUrl: url,
      userId: data.user.id,
      email: data.user.email,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      tenantId: data.user.tenantId,
      tenantName: data.user.tenantName,
    });
    return { success: true, data: { accountId: account.id } };
  } catch (err) {
    return { success: false, error: formatError(err) };
  }
}

async function handleApiRequest(
  accountId: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<BackgroundResponse> {
  try {
    const accounts = await getAccounts();
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return { success: false, error: 'Account not found' };

    const url = `${account.serverUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${account.accessToken}`,
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    // Auto-refresh on 401
    if (res.status === 401) {
      const refreshResult = await refreshTokenForAccount(accountId);
      if (!refreshResult.success) return refreshResult;

      // Retry the request with new token
      const refreshedAccounts = await getAccounts();
      const refreshedAccount = refreshedAccounts.find((a) => a.id === accountId);
      if (!refreshedAccount) return { success: false, error: 'Account not found after refresh' };

      headers['Authorization'] = `Bearer ${refreshedAccount.accessToken}`;
      const retryRes = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
      const retryData: unknown = await retryRes.json().catch(() => null);
      await touchAccount(accountId);
      return retryRes.ok
        ? { success: true, data: retryData }
        : { success: false, error: `Request failed with ${String(retryRes.status)}` };
    }

    const data: unknown = await res.json().catch(() => null);
    await touchAccount(accountId);
    return res.ok
      ? { success: true, data }
      : { success: false, error: `Request failed with ${String(res.status)}` };
  } catch (err) {
    return { success: false, error: formatError(err) };
  }
}

async function refreshTokenForAccount(accountId: string): Promise<BackgroundResponse> {
  try {
    const accounts = await getAccounts();
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return { success: false, error: 'Account not found' };

    const res = await fetch(`${account.serverUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: account.refreshToken }),
    });

    if (!res.ok) return { success: false, error: 'Token refresh failed' };

    const data = (await res.json()) as { accessToken: string; refreshToken: string };
    await updateAccount({
      id: accountId,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: formatError(err) };
  }
}

async function handleGetAccounts(): Promise<BackgroundResponse> {
  const accounts = await getAccounts();
  return { success: true, data: accounts };
}

async function handleSetActiveAccount(accountId: string): Promise<BackgroundResponse> {
  await setActiveAccountId(accountId);
  await touchAccount(accountId);
  return { success: true };
}

async function handleRemoveAccount(accountId: string): Promise<BackgroundResponse> {
  await removeAccount(accountId);
  return { success: true };
}

async function handleUpdateAccount(
  partial: { id: string } & Record<string, unknown>,
): Promise<BackgroundResponse> {
  const result = await updateAccount(partial as Parameters<typeof updateAccount>[0]);
  return result ? { success: true, data: result } : { success: false, error: 'Account not found' };
}

// ── Utilities ──────────────────────────────────────────────────────────

function normalizeUrl(url: string): string {
  let normalized = url.trim();
  // Strip trailing slash
  while (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  // Ensure protocol
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = `https://${normalized}`;
  }
  return normalized;
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
