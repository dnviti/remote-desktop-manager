import crypto from 'crypto';
import * as cache from './cacheClient';
import { config } from '../config';

/**
 * Short-lived one-time link authorization code store.
 *
 * Used by OAuth/SAML account-linking flows to avoid putting JWTs
 * in URL query parameters. The client first POSTs to get a one-time
 * `code` (via Axios with Authorization header), then redirects to
 * the link endpoint with `?code=...` instead of `?token=...`.
 *
 * When a distributed cache backend is available, codes are stored in the
 * distributed cache with TTL-based expiry. Falls back to an
 * in-memory Map when the sidecar is unavailable.
 */

export interface LinkCodeEntry {
  userId: string;
  expiresAt: number;
}

/** In-memory fallback stores */
const linkCodeStore = new Map<string, LinkCodeEntry>();
const relayStateStore = new Map<string, LinkCodeEntry>();

const LINK_CODE_TTL_MS = 60_000; // 60 seconds
const RELAY_STATE_TTL_MS = 300_000; // 5 minutes — allows time for IdP authentication

function cleanupExpiredLinkCodes(): void {
  const now = Date.now();
  for (const [code, entry] of linkCodeStore) {
    if (entry.expiresAt <= now) linkCodeStore.delete(code);
  }
}

function cleanupExpiredRelayCodes(): void {
  const now = Date.now();
  for (const [code, entry] of relayStateStore) {
    if (entry.expiresAt <= now) relayStateStore.delete(code);
  }
}

/** Generate a one-time code that maps to a userId, valid for 60 seconds */
export async function generateLinkCode(userId: string): Promise<string> {
  const code = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + LINK_CODE_TTL_MS;

  if (config.distributedCacheEnabled) {
    const stored = await cache.set(
      `link:code:${code}`,
      JSON.stringify({ userId, expiresAt }),
      { ttl: LINK_CODE_TTL_MS },
    );
    if (stored) return code;
  }

  // Fallback to in-memory
  cleanupExpiredLinkCodes();
  linkCodeStore.set(code, { userId, expiresAt });
  return code;
}

/** Consume a one-time link code, returning the userId or null if invalid/expired */
export async function consumeLinkCode(code: string): Promise<string | null> {
  if (config.distributedCacheEnabled) {
    const buf = await cache.getdel(`link:code:${code}`);
    if (buf) {
      const entry: LinkCodeEntry = JSON.parse(buf.toString());
      if (entry.expiresAt <= Date.now()) return null;
      return entry.userId;
    }
  }

  // In-memory fallback
  cleanupExpiredLinkCodes();
  const entry = linkCodeStore.get(code);
  if (!entry) return null;

  // One-time use: delete immediately
  linkCodeStore.delete(code);

  if (entry.expiresAt <= Date.now()) return null;
  return entry.userId;
}

// ---------------------------------------------------------------------------
// Server-side relay state for OAuth / SAML account-linking callbacks.
//
// Instead of encoding { action, userId } in an HMAC-signed state parameter
// (which CodeQL flags as js/user-controlled-bypass because the returned data
// is still derived from user input), we store the userId server-side keyed by
// a random token. The callback only uses server-controlled data for security
// decisions, breaking the taint chain entirely.
// ---------------------------------------------------------------------------

/** Generate a random relay code that maps to a userId (5-minute TTL, one-time use) */
export async function generateRelayCode(userId: string): Promise<string> {
  const code = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + RELAY_STATE_TTL_MS;

  if (config.distributedCacheEnabled) {
    const stored = await cache.set(
      `relay:code:${code}`,
      JSON.stringify({ userId, expiresAt }),
      { ttl: RELAY_STATE_TTL_MS },
    );
    if (stored) return code;
  }

  // Fallback to in-memory
  cleanupExpiredRelayCodes();
  relayStateStore.set(code, { userId, expiresAt });
  return code;
}

/** Consume a relay code, returning the server-stored userId or null */
export async function consumeRelayCode(code: string): Promise<string | null> {
  if (typeof code !== 'string') return null;

  if (config.distributedCacheEnabled) {
    const buf = await cache.getdel(`relay:code:${code}`);
    if (buf) {
      const entry: LinkCodeEntry = JSON.parse(buf.toString());
      if (entry.expiresAt <= Date.now()) return null;
      return entry.userId;
    }
  }

  // In-memory fallback
  cleanupExpiredRelayCodes();
  const entry = relayStateStore.get(code);
  if (!entry) return null;
  relayStateStore.delete(code);
  if (entry.expiresAt <= Date.now()) return null;
  return entry.userId;
}
