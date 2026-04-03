/**
 * Background service worker — handles ALL API calls to Arsenale servers,
 * bypassing CORS entirely. Popup/options/content pages communicate via chrome.runtime.sendMessage.
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
import { getOrCreateKey } from './lib/tokenEncryption';
import { findMatchingCredentials, extractDomain } from './lib/urlMatcher';
import type { CredentialIndexEntry } from './lib/urlMatcher';
import type {
  AutofillPreferences,
  BackgroundMessage,
  BackgroundResponse,
  HealthCheckResult,
  LoginData,
  LoginResponse,
  LoginResult,
  PendingAccount,
  SecretDetail,
  SecretListItem,
  VaultStatusResponse,
} from './types';

type AutofillRuntimeMessage =
  | { type: 'AUTOFILL_VAULT_STATE_CHANGED'; vaultLocked: boolean }
  | { type: 'AUTOFILL_MATCHES_UPDATED'; matches: CredentialIndexEntry[] };

type InternalRuntimeMessage =
  | { type: 'OFFSCREEN_CLIPBOARD_CLEARED' }
  | { type: 'OFFSCREEN_CLIPBOARD_ERROR'; error?: string };

// ── Clipboard auto-clear alarm ────────────────────────────────────────
const CLIPBOARD_CLEAR_ALARM = 'clipboard-clear';
const OFFSCREEN_CLIPBOARD_PATH = 'offscreen.html';
let offscreenClipboardOpen = false;

// ── Token refresh alarm ────────────────────────────────────────────────
const REFRESH_ALARM = 'token-refresh';
const REFRESH_INTERVAL_MINUTES = 10;

chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_INTERVAL_MINUTES });

// ── Credential index for autofill ───────────────────────────────────
// Lightweight in-memory index of LOGIN-type secrets keyed by accountId.
// Refreshed periodically and on popup open / vault unlock.
const credentialIndex: Map<string, CredentialIndexEntry[]> = new Map();
const CREDENTIAL_INDEX_REFRESH_ALARM = 'credential-index-refresh';
const CREDENTIAL_INDEX_REFRESH_MINUTES = 5;
const AUTOFILL_PREFS_KEY = 'autofillPreferences';

chrome.alarms.create(CREDENTIAL_INDEX_REFRESH_ALARM, {
  periodInMinutes: CREDENTIAL_INDEX_REFRESH_MINUTES,
});

// ── Token encryption key bootstrap ─────────────────────────────────────
// Eagerly create (or restore) the AES-GCM encryption key in
// chrome.storage.session so that token decrypt/encrypt operations in
// accountStore never have to wait for key generation on the hot path.
getOrCreateKey().catch(() => {
  // Best-effort: key will be created lazily on first account access
});

/** Default autofill preferences. */
const defaultAutofillPrefs: AutofillPreferences = {
  globalEnabled: true,
  disabledSites: [],
};

/** Load autofill preferences from chrome.storage.local. */
async function getAutofillPrefs(): Promise<AutofillPreferences> {
  const result = await chrome.storage.local.get(AUTOFILL_PREFS_KEY);
  return (result[AUTOFILL_PREFS_KEY] as AutofillPreferences | undefined) ?? defaultAutofillPrefs;
}

/** Save autofill preferences to chrome.storage.local. */
async function setAutofillPrefs(prefs: AutofillPreferences): Promise<void> {
  await chrome.storage.local.set({ [AUTOFILL_PREFS_KEY]: prefs });
}

/** Build or refresh the credential index for a given account. */
async function refreshCredentialIndex(accountId: string): Promise<void> {
  try {
    const accounts = await getAccounts();
    const account = accounts.find((a) => a.id === accountId);
    if (!account || account.sessionExpired) return;

    // Fetch LOGIN-type secrets (list only, no decrypted data)
    const url = `${account.serverUrl}/api/secrets?type=LOGIN`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${account.accessToken}`,
      },
    });

    if (res.status === 403 || res.status === 401) {
      // Vault locked or session expired — clear index
      credentialIndex.delete(accountId);
      return;
    }

    if (!res.ok) return;

    const secrets = (await res.json()) as SecretListItem[];
    const entries: CredentialIndexEntry[] = secrets.map((s) => ({
      secretId: s.id,
      name: s.name,
      url: (s.metadata?.['url'] as string | undefined) ?? undefined,
      domain: (s.metadata?.['domain'] as string | undefined) ?? undefined,
      accountId,
    }));

    credentialIndex.set(accountId, entries);
  } catch {
    // Best-effort: index refresh failure should not disrupt other operations
  }
}

/** Refresh the credential index for all active (non-expired) accounts. */
async function refreshAllCredentialIndexes(): Promise<void> {
  const accounts = await getAccounts();
  for (const account of accounts) {
    if (!account.sessionExpired) {
      await refreshCredentialIndex(account.id);
    }
  }
  await broadcastAutofillMatchesUpdated();
  await refreshBadgesForOpenTabs();
}

/** Update the extension badge with matching credential count for the active tab. */
async function updateBadgeForTab(tabId: number, pageUrl: string): Promise<void> {
  // Don't override error badges
  const accounts = await getAccounts();
  if (accounts.some((a) => a.sessionExpired)) return;

  const prefs = await getAutofillPrefs();
  if (!prefs.globalEnabled) {
    chrome.action.setBadgeText({ text: '', tabId });
    return;
  }

  // Check if this domain is disabled
  try {
    const hostname = new URL(pageUrl).hostname;
    const domain = extractDomain(hostname);
    if (prefs.disabledSites.some((s) => domain === extractDomain(s) || hostname === s)) {
      chrome.action.setBadgeText({ text: '', tabId });
      return;
    }
  } catch {
    chrome.action.setBadgeText({ text: '', tabId });
    return;
  }

  // Aggregate matches across all accounts
  const allEntries = Array.from(credentialIndex.values()).flat();
  const matches = findMatchingCredentials(allEntries, pageUrl);

  if (matches.length > 0) {
    chrome.action.setBadgeText({ text: String(matches.length), tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#00e5a0', tabId });
  } else {
    chrome.action.setBadgeText({ text: '', tabId });
  }
}

// Update badge when tabs change
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    updateBadgeForTab(tabId, tab.url);
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url) {
      updateBadgeForTab(activeInfo.tabId, tab.url);
    }
  } catch {
    // Tab may have been closed
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  // Credential index periodic refresh
  if (alarm.name === CREDENTIAL_INDEX_REFRESH_ALARM) {
    await refreshAllCredentialIndexes();
    return;
  }

  // Clipboard auto-clear: write empty string to clipboard
  if (alarm.name === CLIPBOARD_CLEAR_ALARM) {
    await triggerClipboardAutoClear();
    return;
  }

  // Per-account refresh alarms are named "token-refresh-{accountId}"
  if (alarm.name.startsWith('token-refresh-')) {
    const accountId = alarm.name.replace('token-refresh-', '');
    const result = await refreshTokenForAccount(accountId);
    if (!result.success) {
      // Mark account as session expired and show badge
      await updateAccount({ id: accountId, sessionExpired: true });
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
    }
    return;
  }

  // Fallback: periodic refresh for active account
  if (alarm.name === REFRESH_ALARM) {
    const account = await getActiveAccount();
    if (!account || account.sessionExpired) return;
    const result = await refreshTokenForAccount(account.id);
    if (!result.success) {
      await updateAccount({ id: account.id, sessionExpired: true });
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
    }
  }
});

// ── Message handler ────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener(
  (
    message: BackgroundMessage | InternalRuntimeMessage,
    _sender,
    sendResponse: (response: BackgroundResponse) => void,
  ) => {
    if (isInternalRuntimeMessage(message)) {
      handleInternalRuntimeMessage(message).then(sendResponse);
      return true;
    }

    handleMessage(message).then(sendResponse);
    // Return true to indicate we will respond asynchronously
    return true;
  },
);

export async function handleMessage(message: BackgroundMessage): Promise<BackgroundResponse> {
  switch (message.type) {
    case 'HEALTH_CHECK':
      return handleHealthCheck(message.serverUrl);
    case 'LOGIN':
      return handleLogin(message.serverUrl, message.email, message.password);
    case 'VERIFY_TOTP':
      return handleVerifyTotp(message.serverUrl, message.tempToken, message.code, message.pendingAccount);
    case 'REQUEST_SMS_CODE':
      return handleRequestSmsCode(message.serverUrl, message.tempToken);
    case 'VERIFY_SMS':
      return handleVerifySms(message.serverUrl, message.tempToken, message.code, message.pendingAccount);
    case 'REQUEST_WEBAUTHN_OPTIONS':
      return handleRequestWebAuthnOptions(message.serverUrl, message.tempToken);
    case 'VERIFY_WEBAUTHN':
      return handleVerifyWebAuthn(
        message.serverUrl,
        message.tempToken,
        message.credential,
        message.pendingAccount,
        message.expectedChallenge,
      );
    case 'SWITCH_TENANT':
      return handleSwitchTenant(message.accountId, message.tenantId);
    case 'LOGOUT_ACCOUNT':
      return handleLogoutAccount(message.accountId);
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
    // ── Autofill handlers ──────────────────────────────────────────
    case 'AUTOFILL_GET_STATUS':
      return handleAutofillGetStatus(message.url);
    case 'AUTOFILL_GET_MATCHES':
      return handleAutofillGetMatches(message.url);
    case 'AUTOFILL_GET_CREDENTIAL':
      return handleAutofillGetCredential(message.secretId, message.accountId);
    case 'AUTOFILL_OPEN_POPUP':
      return handleAutofillOpenPopup();
    case 'AUTOFILL_IS_DISABLED':
      return handleAutofillIsDisabled(message.domain);
    case 'AUTOFILL_SET_DISABLED_SITES':
      return handleAutofillSetDisabledSites(message.sites);
    case 'AUTOFILL_GET_DISABLED_SITES':
      return handleAutofillGetDisabledSites();
    case 'AUTOFILL_SET_GLOBAL_ENABLED':
      return handleAutofillSetGlobalEnabled(message.enabled);
    case 'AUTOFILL_GET_GLOBAL_ENABLED':
      return handleAutofillGetGlobalEnabled();
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
): Promise<BackgroundResponse<LoginResponse>> {
  try {
    const url = normalizeUrl(serverUrl);
    const res = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.text();
      let errorMsg = body || `Login failed with ${String(res.status)}`;
      try {
        const parsed = JSON.parse(body) as { error?: string };
        if (parsed.error) errorMsg = parsed.error;
      } catch { /* use raw body */ }
      return { success: false, error: errorMsg };
    }
    const data = (await res.json()) as LoginResponse;

    // If MFA is required or setup is needed, return the challenge info
    if ('requiresMFA' in data || 'mfaSetupRequired' in data) {
      return { success: true, data };
    }

    // Full success — create account entry
    const loginData = data as LoginResult;
    const account = await addAccount({
      label: loginData.user.name || loginData.user.email,
      serverUrl: url,
      userId: loginData.user.id,
      email: loginData.user.email,
      accessToken: loginData.accessToken,
      refreshToken: loginData.refreshToken,
      tenantId: loginData.user.tenantId,
      tenantName: loginData.user.tenantName,
    });

    // Schedule per-account token refresh
    scheduleRefreshAlarm(account.id, loginData.accessToken);

    // Clear any session expired badge
    await clearBadgeIfNoExpired();
    await broadcastCurrentAutofillState();
    await broadcastAutofillMatchesUpdated();
    await refreshBadgesForOpenTabs();

    return { success: true, data: { ...loginData, accountId: account.id } as unknown as LoginResponse };
  } catch (err) {
    return { success: false, error: formatError(err) };
  }
}

/** Complete MFA with a TOTP code and create the account entry. */
async function handleVerifyTotp(
  serverUrl: string,
  tempToken: string,
  code: string,
  pendingAccount: PendingAccount,
): Promise<BackgroundResponse<LoginResult>> {
  try {
    const url = normalizeUrl(serverUrl);
    const res = await fetch(`${url}/api/auth/verify-totp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempToken, code }),
    });
    if (!res.ok) {
      const body = await res.text();
      let errorMsg = body || `TOTP verification failed (${String(res.status)})`;
      try {
        const parsed = JSON.parse(body) as { error?: string };
        if (parsed.error) errorMsg = parsed.error;
      } catch { /* use raw body */ }
      return { success: false, error: errorMsg };
    }
    const data = (await res.json()) as LoginResult;
    return await createAccountFromMfa(url, pendingAccount, data);
  } catch (err) {
    return { success: false, error: formatError(err) };
  }
}

/** Request an SMS code for MFA. */
async function handleRequestSmsCode(
  serverUrl: string,
  tempToken: string,
): Promise<BackgroundResponse> {
  try {
    const url = normalizeUrl(serverUrl);
    const res = await fetch(`${url}/api/auth/request-sms-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempToken }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { success: false, error: body || `SMS request failed (${String(res.status)})` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: formatError(err) };
  }
}

/** Complete MFA with an SMS code and create the account entry. */
async function handleVerifySms(
  serverUrl: string,
  tempToken: string,
  code: string,
  pendingAccount: PendingAccount,
): Promise<BackgroundResponse<LoginResult>> {
  try {
    const url = normalizeUrl(serverUrl);
    const res = await fetch(`${url}/api/auth/verify-sms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempToken, code }),
    });
    if (!res.ok) {
      const body = await res.text();
      let errorMsg = body || `SMS verification failed (${String(res.status)})`;
      try {
        const parsed = JSON.parse(body) as { error?: string };
        if (parsed.error) errorMsg = parsed.error;
      } catch { /* use raw body */ }
      return { success: false, error: errorMsg };
    }
    const data = (await res.json()) as LoginResult;
    return await createAccountFromMfa(url, pendingAccount, data);
  } catch (err) {
    return { success: false, error: formatError(err) };
  }
}

/** Request WebAuthn assertion options. */
async function handleRequestWebAuthnOptions(
  serverUrl: string,
  tempToken: string,
): Promise<BackgroundResponse<Record<string, unknown>>> {
  try {
    const url = normalizeUrl(serverUrl);
    const res = await fetch(`${url}/api/auth/request-webauthn-options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempToken }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { success: false, error: body || `WebAuthn options request failed (${String(res.status)})` };
    }
    const data = (await res.json()) as Record<string, unknown>;
    return { success: true, data };
  } catch (err) {
    return { success: false, error: formatError(err) };
  }
}

/** Complete MFA with a WebAuthn credential and create the account entry. */
async function handleVerifyWebAuthn(
  serverUrl: string,
  tempToken: string,
  credential: Record<string, unknown>,
  pendingAccount: PendingAccount,
  expectedChallenge?: string,
): Promise<BackgroundResponse<LoginResult>> {
  try {
    const url = normalizeUrl(serverUrl);
    const res = await fetch(`${url}/api/auth/verify-webauthn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempToken, credential, expectedChallenge }),
    });
    if (!res.ok) {
      const body = await res.text();
      let errorMsg = body || `WebAuthn verification failed (${String(res.status)})`;
      try {
        const parsed = JSON.parse(body) as { error?: string };
        if (parsed.error) errorMsg = parsed.error;
      } catch { /* use raw body */ }
      return { success: false, error: errorMsg };
    }
    const data = (await res.json()) as LoginResult;
    return await createAccountFromMfa(url, pendingAccount, data);
  } catch (err) {
    return { success: false, error: formatError(err) };
  }
}

/** Switch tenant for an existing account. */
async function handleSwitchTenant(
  accountId: string,
  tenantId: string,
): Promise<BackgroundResponse> {
  try {
    const accounts = await getAccounts();
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return { success: false, error: 'Account not found' };

    const res = await fetch(`${account.serverUrl}/api/auth/switch-tenant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${account.accessToken}`,
      },
      body: JSON.stringify({ tenantId }),
    });

    if (!res.ok) {
      const body = await res.text();
      return { success: false, error: body || `Tenant switch failed (${String(res.status)})` };
    }

    const data = (await res.json()) as { accessToken: string; refreshToken: string; user: LoginResult['user'] };
    await updateAccount({
      id: accountId,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      tenantId: data.user.tenantId,
      tenantName: data.user.tenantName,
    });

    scheduleRefreshAlarm(accountId, data.accessToken);
    credentialIndex.delete(accountId);
    if (account.vaultUnlocked) {
      await refreshCredentialIndex(accountId);
    }
    await broadcastCurrentAutofillState();
    await broadcastAutofillMatchesUpdated();
    await refreshBadgesForOpenTabs();
    return { success: true, data };
  } catch (err) {
    return { success: false, error: formatError(err) };
  }
}

/** Logout: revoke refresh token on the server and remove the account locally. */
async function handleLogoutAccount(accountId: string): Promise<BackgroundResponse> {
  try {
    const accounts = await getAccounts();
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return { success: false, error: 'Account not found' };

    // Best-effort server logout — send refresh token in body (extension pattern)
    try {
      await fetch(`${account.serverUrl}/api/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${account.accessToken}`,
        },
        body: JSON.stringify({ refreshToken: account.refreshToken }),
      });
    } catch {
      // Server logout is best-effort; continue with local cleanup
    }

    // Cancel the per-account refresh alarm
    chrome.alarms.clear(`token-refresh-${accountId}`);

    await removeAccount(accountId);
    credentialIndex.delete(accountId);
    await clearBadgeIfNoExpired();
    await broadcastCurrentAutofillState();
    await broadcastAutofillMatchesUpdated();
    await refreshBadgesForOpenTabs();
    return { success: true };
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
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;

    const url = `${account.serverUrl}${normalizedPath}`;
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
      if (retryRes.ok) {
        await applySuccessfulApiSideEffects(accountId, normalizedPath);
      }
      return retryRes.ok
        ? { success: true, data: retryData }
        : { success: false, error: `Request failed with ${String(retryRes.status)}` };
    }

    const data: unknown = await res.json().catch(() => null);
    await touchAccount(accountId);
    if (res.ok) {
      await applySuccessfulApiSideEffects(accountId, normalizedPath);
    }
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

    if (!res.ok) {
      // Mark session as expired on 401
      if (res.status === 401) {
        await updateAccount({ id: accountId, sessionExpired: true });
        chrome.action.setBadgeText({ text: '!' });
        chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
      }
      return { success: false, error: 'Token refresh failed' };
    }

    const data = (await res.json()) as { accessToken: string; refreshToken: string };
    await updateAccount({
      id: accountId,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      sessionExpired: false,
    });

    // Reschedule the per-account alarm based on new token expiry
    scheduleRefreshAlarm(accountId, data.accessToken);

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
  await broadcastCurrentAutofillState();
  await broadcastAutofillMatchesUpdated();
  await refreshBadgesForOpenTabs();
  return { success: true };
}

async function handleRemoveAccount(accountId: string): Promise<BackgroundResponse> {
  chrome.alarms.clear(`token-refresh-${accountId}`);
  await removeAccount(accountId);
  credentialIndex.delete(accountId);
  await broadcastCurrentAutofillState();
  await broadcastAutofillMatchesUpdated();
  await refreshBadgesForOpenTabs();
  return { success: true };
}

async function handleUpdateAccount(
  partial: { id: string } & Record<string, unknown>,
): Promise<BackgroundResponse> {
  const result = await updateAccount(partial as Parameters<typeof updateAccount>[0]);
  if (result && partial.vaultUnlocked !== undefined) {
    if (partial.vaultUnlocked) {
      await refreshCredentialIndex(partial.id);
    } else {
      credentialIndex.delete(partial.id);
    }
    await broadcastCurrentAutofillState();
    await broadcastAutofillMatchesUpdated();
    await refreshBadgesForOpenTabs();
  }
  return result ? { success: true, data: result } : { success: false, error: 'Account not found' };
}

// ── Autofill handlers ───────────────────────────────────────────────────

/** Check autofill status for the content script. */
async function handleAutofillGetStatus(
  _url: string,
): Promise<BackgroundResponse<{ hasAccount: boolean; vaultLocked: boolean; autofillDisabledGlobally: boolean }>> {
  try {
    const prefs = await getAutofillPrefs();
    const account = await getActiveAccount();
    if (!account) {
      return { success: true, data: { hasAccount: false, vaultLocked: true, autofillDisabledGlobally: !prefs.globalEnabled } };
    }

    // Check vault status
    const vaultRes = await fetch(`${account.serverUrl}/api/vault/status`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${account.accessToken}`,
      },
    });

    let vaultLocked = true;
    if (vaultRes.ok) {
      const vaultData = (await vaultRes.json()) as VaultStatusResponse;
      vaultLocked = !vaultData.unlocked;
    }

    return {
      success: true,
      data: {
        hasAccount: true,
        vaultLocked,
        autofillDisabledGlobally: !prefs.globalEnabled,
      },
    };
  } catch (err) {
    return { success: false, error: formatError(err) };
  }
}

/** Find matching credentials for a URL. */
async function handleAutofillGetMatches(
  pageUrl: string,
): Promise<BackgroundResponse<CredentialIndexEntry[]>> {
  try {
    const account = await getActiveAccount();
    if (!account) return { success: true, data: [] };

    // Ensure index is populated
    if (!credentialIndex.has(account.id)) {
      await refreshCredentialIndex(account.id);
    }

    const entries = credentialIndex.get(account.id) ?? [];
    const matches = findMatchingCredentials(entries, pageUrl);
    return { success: true, data: matches };
  } catch (err) {
    return { success: false, error: formatError(err) };
  }
}

/** Fetch full decrypted credential data for autofill. */
async function handleAutofillGetCredential(
  secretId: string,
  accountId: string,
): Promise<BackgroundResponse<{ username: string; password: string }>> {
  try {
    const accounts = await getAccounts();
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return { success: false, error: 'Account not found' };

    const url = `${account.serverUrl}/api/secrets/${secretId}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${account.accessToken}`,
      },
    });

    if (res.status === 403) {
      return { success: false, error: 'vault_locked' };
    }

    if (!res.ok) {
      return { success: false, error: `Failed to fetch credential (${String(res.status)})` };
    }

    const secret = (await res.json()) as SecretDetail;
    if (secret.data.type !== 'LOGIN') {
      return { success: false, error: 'Not a LOGIN secret' };
    }

    const loginData = secret.data as LoginData;
    return {
      success: true,
      data: {
        username: loginData.username,
        password: loginData.password,
      },
    };
  } catch (err) {
    return { success: false, error: formatError(err) };
  }
}

/** Open the extension popup (best-effort). */
async function handleAutofillOpenPopup(): Promise<BackgroundResponse> {
  try {
    // chrome.action.openPopup() is available in Chrome 99+
    if (chrome.action.openPopup) {
      await chrome.action.openPopup();
    }
    return { success: true };
  } catch {
    // openPopup may fail if no active window; this is fine
    return { success: true };
  }
}

/** Check if autofill is disabled for a specific domain. */
async function handleAutofillIsDisabled(
  domain: string,
): Promise<BackgroundResponse<{ disabled: boolean }>> {
  try {
    const prefs = await getAutofillPrefs();
    if (!prefs.globalEnabled) {
      return { success: true, data: { disabled: true } };
    }
    const normalized = extractDomain(domain);
    const isDisabled = prefs.disabledSites.some(
      (s) => extractDomain(s) === normalized || s === domain,
    );
    return { success: true, data: { disabled: isDisabled } };
  } catch (err) {
    return { success: false, error: formatError(err) };
  }
}

/** Set the list of disabled sites. */
async function handleAutofillSetDisabledSites(
  sites: string[],
): Promise<BackgroundResponse> {
  const prefs = await getAutofillPrefs();
  prefs.disabledSites = sites;
  await setAutofillPrefs(prefs);
  await refreshBadgesForOpenTabs();
  return { success: true };
}

/** Get the list of disabled sites. */
async function handleAutofillGetDisabledSites(): Promise<BackgroundResponse<{ sites: string[] }>> {
  const prefs = await getAutofillPrefs();
  return { success: true, data: { sites: prefs.disabledSites } };
}

/** Set global autofill enabled/disabled. */
async function handleAutofillSetGlobalEnabled(
  enabled: boolean,
): Promise<BackgroundResponse> {
  const prefs = await getAutofillPrefs();
  prefs.globalEnabled = enabled;
  await setAutofillPrefs(prefs);
  await refreshBadgesForOpenTabs();
  return { success: true };
}

/** Get global autofill enabled state. */
async function handleAutofillGetGlobalEnabled(): Promise<BackgroundResponse<{ enabled: boolean }>> {
  const prefs = await getAutofillPrefs();
  return { success: true, data: { enabled: prefs.globalEnabled } };
}

// ── Shared helpers ─────────────────────────────────────────────────────

/** After MFA verification succeeds, create the account entry and schedule refresh. */
async function createAccountFromMfa(
  serverUrl: string,
  pendingAccount: PendingAccount,
  data: LoginResult,
): Promise<BackgroundResponse<LoginResult>> {
  const account = await addAccount({
    label: data.user.name || data.user.email,
    serverUrl,
    userId: data.user.id,
    email: pendingAccount.email,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    tenantId: data.user.tenantId,
    tenantName: data.user.tenantName,
  });

  scheduleRefreshAlarm(account.id, data.accessToken);
  await clearBadgeIfNoExpired();
  await broadcastCurrentAutofillState();
  await broadcastAutofillMatchesUpdated();
  await refreshBadgesForOpenTabs();

  return { success: true, data: { ...data, accountId: account.id } as unknown as LoginResult };
}

/**
 * Parse a JWT access token and schedule a chrome.alarms alarm 60s before expiry.
 */
function scheduleRefreshAlarm(accountId: string, accessToken: string): void {
  try {
    const payload = accessToken.split('.')[1];
    if (!payload) return;
    const decoded = JSON.parse(atob(payload)) as { exp?: number };
    if (!decoded.exp) return;

    const expiryMs = decoded.exp * 1000;
    const fireAt = expiryMs - 60_000; // 60s before expiry
    const delayMs = Math.max(fireAt - Date.now(), 5_000); // at least 5s

    chrome.alarms.create(`token-refresh-${accountId}`, {
      delayInMinutes: delayMs / 60_000,
    });
  } catch {
    // If token parsing fails, fall back to the periodic alarm
  }
}

/** Clear the error badge if no accounts have expired sessions. */
async function clearBadgeIfNoExpired(): Promise<void> {
  const accounts = await getAccounts();
  const hasExpired = accounts.some((a) => a.sessionExpired);
  if (!hasExpired) {
    chrome.action.setBadgeText({ text: '' });
  }
}

function isInternalRuntimeMessage(
  message: BackgroundMessage | InternalRuntimeMessage,
): message is InternalRuntimeMessage {
  return (
    message.type === 'OFFSCREEN_CLIPBOARD_CLEARED' ||
    message.type === 'OFFSCREEN_CLIPBOARD_ERROR'
  );
}

async function handleInternalRuntimeMessage(
  message: InternalRuntimeMessage,
): Promise<BackgroundResponse> {
  offscreenClipboardOpen = false;
  await chrome.offscreen?.closeDocument?.();

  if (message.type === 'OFFSCREEN_CLIPBOARD_ERROR') {
    return { success: false, error: message.error ?? 'Clipboard clear failed' };
  }

  return { success: true };
}

async function applySuccessfulApiSideEffects(
  accountId: string,
  normalizedPath: string,
): Promise<void> {
  if (normalizedPath === '/api/vault/lock') {
    credentialIndex.delete(accountId);
    await updateAccount({ id: accountId, vaultUnlocked: false });
    await broadcastCurrentAutofillState();
    await broadcastAutofillMatchesUpdated();
    await refreshBadgesForOpenTabs();
    return;
  }

  if (
    normalizedPath === '/api/vault/unlock' ||
    normalizedPath === '/api/vault/unlock-mfa/totp' ||
    normalizedPath === '/api/vault/unlock-mfa/sms' ||
    normalizedPath === '/api/vault/unlock-mfa/webauthn'
  ) {
    await updateAccount({ id: accountId, vaultUnlocked: true });
    await refreshCredentialIndex(accountId);
    await broadcastCurrentAutofillState();
    await broadcastAutofillMatchesUpdated();
    await refreshBadgesForOpenTabs();
  }
}

async function broadcastCurrentAutofillState(): Promise<void> {
  const activeAccount = await getActiveAccount();
  const vaultLocked =
    !activeAccount || activeAccount.sessionExpired || !activeAccount.vaultUnlocked;

  await sendAutofillMessageToTabs(() => ({
    type: 'AUTOFILL_VAULT_STATE_CHANGED',
    vaultLocked,
  }));
}

async function broadcastAutofillMatchesUpdated(): Promise<void> {
  const activeAccount = await getActiveAccount();
  const canUseMatches =
    !!activeAccount && !activeAccount.sessionExpired && activeAccount.vaultUnlocked;
  const entries = canUseMatches ? credentialIndex.get(activeAccount.id) ?? [] : [];

  await sendAutofillMessageToTabs((tab) => ({
    type: 'AUTOFILL_MATCHES_UPDATED',
    matches: canUseMatches ? findMatchingCredentials(entries, tab.url) : [],
  }));
}

async function refreshBadgesForOpenTabs(): Promise<void> {
  const tabs = await getAddressableTabs();
  await Promise.all(tabs.map((tab) => updateBadgeForTab(tab.id, tab.url)));
}

async function sendAutofillMessageToTabs(
  buildMessage: (
    tab: chrome.tabs.Tab & { id: number; url: string },
  ) => AutofillRuntimeMessage,
): Promise<void> {
  const tabs = await getAddressableTabs();
  await Promise.all(tabs.map(async (tab) => {
    try {
      await chrome.tabs.sendMessage(tab.id, buildMessage(tab));
    } catch {
      // Ignore tabs without an injected content script.
    }
  }));
}

async function getAddressableTabs(): Promise<Array<chrome.tabs.Tab & { id: number; url: string }>> {
  const tabs = await chrome.tabs.query({});
  return tabs.filter(
    (tab): tab is chrome.tabs.Tab & { id: number; url: string } =>
      typeof tab.id === 'number' &&
      typeof tab.url === 'string' &&
      (tab.url.startsWith('https://') || tab.url.startsWith('http://')),
  );
}

async function triggerClipboardAutoClear(): Promise<void> {
  if (!chrome.offscreen?.createDocument || !chrome.runtime.getURL || offscreenClipboardOpen) {
    return;
  }

  offscreenClipboardOpen = true;

  try {
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL(OFFSCREEN_CLIPBOARD_PATH),
      reasons: [chrome.offscreen.Reason.CLIPBOARD],
      justification: 'Clear copied secrets from the clipboard after the timeout expires.',
    });
  } catch {
    offscreenClipboardOpen = false;
  }
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
