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
