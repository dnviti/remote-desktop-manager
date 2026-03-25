/**
 * Azure Key Vault adapter.
 *
 * Auth methods:
 *   CLIENT_CREDENTIALS — { tenantId, clientId, clientSecret }
 *   MANAGED_IDENTITY   — { clientId? }   (uses IMDS endpoint)
 *
 * serverUrl = vault URI, e.g. https://myvault.vault.azure.net
 * secretPath = secret name, optionally with version: "my-secret" or "my-secret/version-id"
 */

import { decryptWithServerKey } from '../crypto.service';
import { AppError } from '../../middleware/error.middleware';
import type { VaultAdapter, VaultProviderRow } from './types';

const REQUEST_TIMEOUT_MS = 10_000;
const API_VERSION = '7.4';

// ---------- Token cache ----------

interface CachedToken { accessToken: string; expiresAt: number }
const tokenCache = new Map<string, CachedToken>();

interface CachedSecret { data: Record<string, string>; expiresAt: number }
const secretCache = new Map<string, CachedSecret>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of tokenCache.entries()) {
    if (entry.expiresAt < now) tokenCache.delete(key);
  }
  for (const [key, entry] of secretCache.entries()) {
    if (entry.expiresAt < now) secretCache.delete(key);
  }
}, 60_000);

// ---------- Authentication ----------

interface AzurePayload {
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
}

function parsePayload(provider: VaultProviderRow): AzurePayload {
  const json = decryptWithServerKey({
    ciphertext: provider.encryptedAuthPayload,
    iv: provider.authPayloadIV,
    tag: provider.authPayloadTag,
  });

  try {
    return JSON.parse(json) as AzurePayload;
  } catch {
    throw new AppError('Failed to parse Azure auth payload — credentials may be corrupted', 500);
  }
}

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    return resp;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new AppError(`Azure Key Vault request timed out after ${REQUEST_TIMEOUT_MS}ms`, 504);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveAccessToken(provider: VaultProviderRow): Promise<string> {
  const cached = tokenCache.get(provider.id);
  if (cached && cached.expiresAt > Date.now()) return cached.accessToken;

  const payload = parsePayload(provider);

  if (provider.authMethod === 'MANAGED_IDENTITY') {
    // Azure IMDS token endpoint
    const params = new URLSearchParams({
      'api-version': '2019-08-01',
      resource: 'https://vault.azure.net',
    });
    if (payload.clientId) params.set('client_id', payload.clientId);

    const resp = await timedFetch(
      `http://169.254.169.254/metadata/identity/oauth2/token?${params}`,
      { headers: { Metadata: 'true' } },
    );

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new AppError(`Azure IMDS token request failed (${resp.status}): ${text.slice(0, 200)}`, 502);
    }

    const body = (await resp.json()) as { access_token: string; expires_in: string };
    const expiresIn = parseInt(body.expires_in, 10) || 3600;
    tokenCache.set(provider.id, { accessToken: body.access_token, expiresAt: Date.now() + (expiresIn - 60) * 1000 });
    return body.access_token;
  }

  // CLIENT_CREDENTIALS
  if (!payload.tenantId || !payload.clientId || !payload.clientSecret) {
    throw new AppError('Azure CLIENT_CREDENTIALS auth requires tenantId, clientId, and clientSecret', 400);
  }

  const tokenUrl = `https://login.microsoftonline.com/${payload.tenantId}/oauth2/v2.0/token`;
  const formBody = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: payload.clientId,
    client_secret: payload.clientSecret,
    scope: 'https://vault.azure.net/.default',
  });

  const resp = await timedFetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new AppError(`Azure OAuth2 token request failed (${resp.status}): ${text.slice(0, 200)}`, 502);
  }

  const body = (await resp.json()) as { access_token: string; expires_in: number };
  tokenCache.set(provider.id, { accessToken: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 });
  return body.access_token;
}

// ---------- Secret retrieval ----------

function parseSecretPath(secretPath: string): { secretName: string; version: string } {
  const [secretName, version] = secretPath.split('/', 2);
  return { secretName, version: version || '' };
}

async function fetchSecret(provider: VaultProviderRow, secretPath: string): Promise<Record<string, string>> {
  const token = await resolveAccessToken(provider);
  const vaultUrl = provider.serverUrl.replace(/\/+$/, '');
  const { secretName, version } = parseSecretPath(secretPath);

  const versionSuffix = version ? `/${version}` : '';
  const url = `${vaultUrl}/secrets/${secretName}${versionSuffix}?api-version=${API_VERSION}`;

  const resp = await timedFetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new AppError(`Azure Key Vault API error (${resp.status}): ${text.slice(0, 200)}`, 502);
  }

  const body = (await resp.json()) as { value?: string; contentType?: string };
  if (body.value === undefined) {
    throw new AppError(`Secret "${secretName}" has no value`, 502);
  }

  // Try parsing as JSON (multi-field secret). Fall back to { value }.
  try {
    return JSON.parse(body.value) as Record<string, string>;
  } catch {
    return { value: body.value };
  }
}

// ---------- Adapter ----------

export const azureAdapter: VaultAdapter = {
  async readSecret(provider, secretPath) {
    const cacheKey = `${provider.id}:${secretPath}`;
    const cached = secretCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const data = await fetchSecret(provider, secretPath);

    if (provider.cacheTtlSeconds > 0) {
      secretCache.set(cacheKey, { data, expiresAt: Date.now() + provider.cacheTtlSeconds * 1000 });
    }
    return data;
  },

  async testConnection(provider, secretPath) {
    try {
      const data = await this.readSecret(provider, secretPath);
      return { success: true, keys: Object.keys(data) };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  },
};

export function invalidateAzureCaches(providerId: string): void {
  tokenCache.delete(providerId);
  for (const key of secretCache.keys()) {
    if (key.startsWith(`${providerId}:`)) secretCache.delete(key);
  }
}
