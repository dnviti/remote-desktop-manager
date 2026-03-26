import crypto from 'crypto';
import * as cache from './cacheClient';
import { config } from '../config';

/**
 * Short-lived one-time authorization code store.
 *
 * Used by OAuth/SAML callback flows to avoid putting access tokens
 * in URL parameters. The callback redirects with a one-time `code`
 * that the client exchanges via POST for the actual token data.
 *
 * When the cache sidecar is available, codes are stored in the
 * distributed cache with TTL-based expiry. Falls back to an
 * in-memory Map when the sidecar is unavailable.
 */

export interface AuthCodeEntry {
  accessToken: string;
  csrfToken: string;
  needsVaultSetup: boolean;
  userId: string;
  email: string;
  username: string;
  avatarData: string;
  tenantId: string;
  tenantRole: string;
  expiresAt: number;
}

/** In-memory fallback when the sidecar is unavailable */
const authCodeStore = new Map<string, AuthCodeEntry>();

const AUTH_CODE_TTL_MS = 60_000; // 60 seconds

function cleanupExpiredCodes(): void {
  const now = Date.now();
  for (const [code, entry] of authCodeStore) {
    if (entry.expiresAt <= now) authCodeStore.delete(code);
  }
}

/** Generate a one-time code and store the token data with a 60-second TTL */
export async function generateAuthCode(data: Omit<AuthCodeEntry, 'expiresAt'>): Promise<string> {
  const code = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + AUTH_CODE_TTL_MS;

  if (config.cacheSidecarEnabled) {
    const stored = await cache.set(
      `auth:code:${code}`,
      JSON.stringify({ ...data, expiresAt }),
      { ttl: AUTH_CODE_TTL_MS },
    );
    if (stored) return code;
  }

  // Fallback to in-memory
  cleanupExpiredCodes();
  authCodeStore.set(code, { ...data, expiresAt });
  return code;
}

/** Consume a one-time code, returning the stored data or null if invalid/expired */
export async function consumeAuthCode(code: string): Promise<Omit<AuthCodeEntry, 'expiresAt'> | null> {
  if (config.cacheSidecarEnabled) {
    const buf = await cache.getdel(`auth:code:${code}`);
    if (buf) {
      const entry: AuthCodeEntry = JSON.parse(buf.toString());
      if (entry.expiresAt <= Date.now()) return null;
      const { expiresAt: _, ...data } = entry;
      return data;
    }
    // If cache returned null, try in-memory fallback (code may have been stored
    // there if sidecar was temporarily unavailable at generation time)
  }

  // In-memory fallback
  cleanupExpiredCodes();
  const entry = authCodeStore.get(code);
  if (!entry) return null;

  // One-time use: delete immediately
  authCodeStore.delete(code);

  if (entry.expiresAt <= Date.now()) return null;

  const { expiresAt: _, ...data } = entry;
  return data;
}
