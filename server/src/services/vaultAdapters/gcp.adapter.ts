/**
 * GCP Secret Manager adapter.
 *
 * Auth methods:
 *   SERVICE_ACCOUNT_KEY — { serviceAccountKey (JSON), projectId? }
 *   WORKLOAD_IDENTITY   — { projectId }   (uses GCE metadata / Workload Identity)
 *
 * secretPath format: "my-secret" or "my-secret/versions/5"
 * Defaults to "versions/latest" if no version is specified.
 */

import { createSign } from 'node:crypto';
import { decryptWithServerKey } from '../crypto.service';
import { AppError } from '../../middleware/error.middleware';
import type { VaultAdapter, VaultProviderRow } from './types';

const REQUEST_TIMEOUT_MS = 10_000;

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

interface GcpServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

interface GcpPayload {
  serviceAccountKey?: string; // JSON string
  projectId?: string;
}

function parsePayload(provider: VaultProviderRow): GcpPayload {
  const json = decryptWithServerKey({
    ciphertext: provider.encryptedAuthPayload,
    iv: provider.authPayloadIV,
    tag: provider.authPayloadTag,
  });
  try {
    return JSON.parse(json) as GcpPayload;
  } catch {
    throw new AppError('Failed to parse GCP auth payload — credentials may be corrupted', 500);
  }
}

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new AppError(`GCP Secret Manager request timed out after ${REQUEST_TIMEOUT_MS}ms`, 504);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------- Service Account JWT -> Access Token ----------

function base64url(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  return buf.toString('base64url');
}

function createJwt(sa: GcpServiceAccount): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email,
    sub: sa.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
  };

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  const signature = signer.sign(sa.private_key, 'base64url');
  return `${unsigned}.${signature}`;
}

async function getServiceAccountToken(provider: VaultProviderRow, sa: GcpServiceAccount): Promise<string> {
  const cached = tokenCache.get(provider.id);
  if (cached && cached.expiresAt > Date.now()) return cached.accessToken;

  const jwt = createJwt(sa);
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  });

  const resp = await timedFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new AppError(`GCP OAuth2 token request failed (${resp.status}): ${text.slice(0, 200)}`, 502);
  }

  const result = (await resp.json()) as { access_token: string; expires_in: number };
  tokenCache.set(provider.id, { accessToken: result.access_token, expiresAt: Date.now() + (result.expires_in - 60) * 1000 });
  return result.access_token;
}

async function getWorkloadIdentityToken(provider: VaultProviderRow): Promise<string> {
  const cached = tokenCache.get(provider.id);
  if (cached && cached.expiresAt > Date.now()) return cached.accessToken;

  // GCE metadata server
  const resp = await timedFetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' } },
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new AppError(`GCP metadata token request failed (${resp.status}): ${text.slice(0, 200)}`, 502);
  }

  const result = (await resp.json()) as { access_token: string; expires_in: number };
  tokenCache.set(provider.id, { accessToken: result.access_token, expiresAt: Date.now() + (result.expires_in - 60) * 1000 });
  return result.access_token;
}

// ---------- Secret retrieval ----------

function parseSecretPath(secretPath: string, projectId: string): string {
  // "my-secret" → "projects/{project}/secrets/my-secret/versions/latest"
  // "my-secret/versions/5" → "projects/{project}/secrets/my-secret/versions/5"
  if (secretPath.startsWith('projects/')) return secretPath; // fully qualified
  const parts = secretPath.split('/');
  const secretName = parts[0];
  const version = parts.length >= 3 ? parts.slice(1).join('/') : 'versions/latest';
  return `projects/${projectId}/secrets/${secretName}/${version}`;
}

async function fetchSecret(provider: VaultProviderRow): Promise<{ token: string; projectId: string }> {
  const payload = parsePayload(provider);

  if (provider.authMethod === 'SERVICE_ACCOUNT_KEY') {
    if (!payload.serviceAccountKey) {
      throw new AppError('GCP SERVICE_ACCOUNT_KEY auth requires serviceAccountKey in auth payload', 400);
    }
    let sa: GcpServiceAccount;
    try {
      sa = JSON.parse(payload.serviceAccountKey) as GcpServiceAccount;
    } catch {
      throw new AppError('GCP service account key JSON is malformed', 400);
    }
    const projectId = payload.projectId || sa.project_id;
    if (!projectId) throw new AppError('GCP auth payload must include projectId', 400);
    const token = await getServiceAccountToken(provider, sa);
    return { token, projectId };
  }

  // WORKLOAD_IDENTITY
  const projectId = payload.projectId;
  if (!projectId) throw new AppError('GCP WORKLOAD_IDENTITY auth requires projectId in auth payload', 400);
  const token = await getWorkloadIdentityToken(provider);
  return { token, projectId };
}

// ---------- Adapter ----------

export const gcpAdapter: VaultAdapter = {
  async readSecret(provider, secretPath) {
    const cacheKey = `${provider.id}:${secretPath}`;
    const cached = secretCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const { token, projectId } = await fetchSecret(provider);
    const resourceName = parseSecretPath(secretPath, projectId);
    const url = `https://secretmanager.googleapis.com/v1/${resourceName}:access`;

    const resp = await timedFetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new AppError(`GCP Secret Manager API error (${resp.status}): ${text.slice(0, 200)}`, 502);
    }

    const body = (await resp.json()) as { payload?: { data?: string } };
    if (!body.payload?.data) {
      throw new AppError(`Secret "${secretPath}" has no payload data`, 502);
    }

    const decoded = Buffer.from(body.payload.data, 'base64').toString('utf-8');
    let data: Record<string, string>;
    try {
      data = JSON.parse(decoded) as Record<string, string>;
    } catch {
      data = { value: decoded };
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

export function invalidateGcpCaches(providerId: string): void {
  tokenCache.delete(providerId);
  for (const key of secretCache.keys()) {
    if (key.startsWith(`${providerId}:`)) secretCache.delete(key);
  }
}
