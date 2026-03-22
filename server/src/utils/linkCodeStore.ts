import crypto from 'crypto';

/**
 * Short-lived one-time link authorization code store.
 *
 * Used by OAuth/SAML account-linking flows to avoid putting JWTs
 * in URL query parameters. The client first POSTs to get a one-time
 * `code` (via Axios with Authorization header), then redirects to
 * the link endpoint with `?code=...` instead of `?token=...`.
 */

export interface LinkCodeEntry {
  userId: string;
  expiresAt: number;
}

const linkCodeStore = new Map<string, LinkCodeEntry>();

const LINK_CODE_TTL_MS = 60_000; // 60 seconds

export function cleanupExpiredLinkCodes(): void {
  const now = Date.now();
  for (const [code, entry] of linkCodeStore) {
    if (entry.expiresAt <= now) linkCodeStore.delete(code);
  }
}

/** Generate a one-time code that maps to a userId, valid for 60 seconds */
export function generateLinkCode(userId: string): string {
  cleanupExpiredLinkCodes();
  const code = crypto.randomBytes(32).toString('hex');
  linkCodeStore.set(code, { userId, expiresAt: Date.now() + LINK_CODE_TTL_MS });
  return code;
}

/** Consume a one-time link code, returning the userId or null if invalid/expired */
export function consumeLinkCode(code: string): string | null {
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

const relayStateStore = new Map<string, LinkCodeEntry>();
const RELAY_STATE_TTL_MS = 300_000; // 5 minutes — allows time for IdP authentication

function cleanupExpiredRelayCodes(): void {
  const now = Date.now();
  for (const [code, entry] of relayStateStore) {
    if (entry.expiresAt <= now) relayStateStore.delete(code);
  }
}

/** Generate a random relay code that maps to a userId (5-minute TTL, one-time use) */
export function generateRelayCode(userId: string): string {
  cleanupExpiredRelayCodes();
  const code = crypto.randomBytes(32).toString('hex');
  relayStateStore.set(code, { userId, expiresAt: Date.now() + RELAY_STATE_TTL_MS });
  return code;
}

/** Consume a relay code, returning the server-stored userId or null */
export function consumeRelayCode(code: string): string | null {
  cleanupExpiredRelayCodes();
  if (typeof code !== 'string') return null;
  const entry = relayStateStore.get(code);
  if (!entry) return null;
  relayStateStore.delete(code);
  if (entry.expiresAt <= Date.now()) return null;
  return entry.userId;
}
