/**
 * CyberArk Conjur adapter.
 *
 * Auth methods:
 *   CONJUR_API_KEY    — { login, apiKey, account }
 *   CONJUR_AUTHN_K8S  — { serviceId, account, hostId? }  (uses pod service-account token)
 *
 * serverUrl = Conjur appliance URL, e.g. https://conjur.example.com
 * secretPath = variable ID with policy-path addressing, e.g. "myapp/db/password"
 */

import { Agent } from 'undici';
import { decryptWithServerKey } from '../crypto.service';
import { AppError } from '../../middleware/error.middleware';
import type { VaultAdapter, VaultProviderRow } from './types';
import { readFile } from 'node:fs/promises';

const REQUEST_TIMEOUT_MS = 10_000;
const K8S_SA_TOKEN_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/token';

// ---------- Caches ----------

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

// ---------- Helpers ----------

interface ConjurPayload {
  login?: string;
  apiKey?: string;
  account?: string;
  serviceId?: string;
  hostId?: string;
}

function parsePayload(provider: VaultProviderRow): ConjurPayload {
  const json = decryptWithServerKey({
    ciphertext: provider.encryptedAuthPayload,
    iv: provider.authPayloadIV,
    tag: provider.authPayloadTag,
  });
  try {
    return JSON.parse(json) as ConjurPayload;
  } catch {
    throw new AppError('Failed to parse Conjur auth payload — credentials may be corrupted', 500);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildFetchOptions(provider: VaultProviderRow): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opts: Record<string, any> = {};
  if (provider.caCertificate) {
    opts.dispatcher = new Agent({ connect: { ca: provider.caCertificate } });
  }
  return opts;
}

async function timedFetch(url: string, init: RequestInit, provider: VaultProviderRow): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const extra = buildFetchOptions(provider);
  try {
    return await fetch(url, { ...init, ...extra, signal: controller.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new AppError(`Conjur request timed out after ${REQUEST_TIMEOUT_MS}ms`, 504);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------- Authentication ----------

async function authenticateApiKey(provider: VaultProviderRow, payload: ConjurPayload): Promise<string> {
  if (!payload.login || !payload.apiKey || !payload.account) {
    throw new AppError('Conjur CONJUR_API_KEY auth requires login, apiKey, and account', 400);
  }

  const cached = tokenCache.get(provider.id);
  if (cached && cached.expiresAt > Date.now()) return cached.accessToken;

  const base = provider.serverUrl.replace(/\/+$/, '');
  const loginEncoded = encodeURIComponent(payload.login);
  const url = `${base}/authn/${payload.account}/${loginEncoded}/authenticate`;

  const resp = await timedFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', Accept: 'text/plain' },
    body: payload.apiKey,
  }, provider);

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new AppError(`Conjur API key auth failed (${resp.status}): ${text.slice(0, 200)}`, 502);
  }

  const accessToken = await resp.text();
  // Conjur tokens are valid for ~8 minutes by default
  tokenCache.set(provider.id, { accessToken, expiresAt: Date.now() + 7 * 60 * 1000 });
  return accessToken;
}

async function authenticateK8s(provider: VaultProviderRow, payload: ConjurPayload): Promise<string> {
  if (!payload.serviceId || !payload.account) {
    throw new AppError('Conjur CONJUR_AUTHN_K8S auth requires serviceId and account', 400);
  }

  const cached = tokenCache.get(provider.id);
  if (cached && cached.expiresAt > Date.now()) return cached.accessToken;

  let k8sToken: string;
  try {
    k8sToken = await readFile(K8S_SA_TOKEN_PATH, 'utf-8');
  } catch {
    throw new AppError('Cannot read Kubernetes service account token — is this running in a pod?', 400);
  }

  const base = provider.serverUrl.replace(/\/+$/, '');
  const hostId = payload.hostId ?? '';
  const loginEncoded = encodeURIComponent(hostId);
  const url = `${base}/authn-k8s/${payload.serviceId}/${payload.account}/${loginEncoded}/authenticate`;

  const resp = await timedFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', Accept: 'text/plain' },
    body: k8sToken,
  }, provider);

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new AppError(`Conjur K8s auth failed (${resp.status}): ${text.slice(0, 200)}`, 502);
  }

  const accessToken = await resp.text();
  tokenCache.set(provider.id, { accessToken, expiresAt: Date.now() + 7 * 60 * 1000 });
  return accessToken;
}

async function resolveAccessToken(provider: VaultProviderRow): Promise<{ token: string; account: string }> {
  const payload = parsePayload(provider);
  const account = payload.account ?? '';
  if (!account) throw new AppError('Conjur auth payload must include account', 400);

  if (provider.authMethod === 'CONJUR_AUTHN_K8S') {
    const token = await authenticateK8s(provider, payload);
    return { token, account };
  }
  const token = await authenticateApiKey(provider, payload);
  return { token, account };
}

// ---------- Adapter ----------

export const conjurAdapter: VaultAdapter = {
  async readSecret(provider, secretPath) {
    const cacheKey = `${provider.id}:${secretPath}`;
    const cached = secretCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const { token, account } = await resolveAccessToken(provider);
    const base = provider.serverUrl.replace(/\/+$/, '');

    // Conjur variable IDs use policy path, e.g. "myapp/db/password"
    const variableId = encodeURIComponent(secretPath);
    const url = `${base}/secrets/${account}/variable/${variableId}`;

    const tokenBase64 = Buffer.from(token).toString('base64');

    const resp = await timedFetch(url, {
      headers: { Authorization: `Token token="${tokenBase64}"` },
    }, provider);

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new AppError(`Conjur API error (${resp.status}): ${text.slice(0, 200)}`, 502);
    }

    const raw = await resp.text();

    // Conjur returns a single value per variable. Try JSON parse for structured secrets.
    let data: Record<string, string>;
    try {
      data = JSON.parse(raw) as Record<string, string>;
    } catch {
      data = { value: raw };
    }

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

export function invalidateConjurCaches(providerId: string): void {
  tokenCache.delete(providerId);
  for (const key of secretCache.keys()) {
    if (key.startsWith(`${providerId}:`)) secretCache.delete(key);
  }
}
