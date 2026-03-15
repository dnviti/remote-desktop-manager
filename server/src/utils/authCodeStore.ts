import crypto from 'crypto';

/**
 * Short-lived one-time authorization code store.
 *
 * Used by OAuth/SAML callback flows to avoid putting access tokens
 * in URL parameters. The callback redirects with a one-time `code`
 * that the client exchanges via POST for the actual token data.
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

const authCodeStore = new Map<string, AuthCodeEntry>();

const AUTH_CODE_TTL_MS = 60_000; // 60 seconds

export function cleanupExpiredCodes(): void {
  const now = Date.now();
  for (const [code, entry] of authCodeStore) {
    if (entry.expiresAt <= now) authCodeStore.delete(code);
  }
}

/** Generate a one-time code and store the token data with a 60-second TTL */
export function generateAuthCode(data: Omit<AuthCodeEntry, 'expiresAt'>): string {
  cleanupExpiredCodes();
  const code = crypto.randomBytes(32).toString('hex');
  authCodeStore.set(code, { ...data, expiresAt: Date.now() + AUTH_CODE_TTL_MS });
  return code;
}

/** Consume a one-time code, returning the stored data or null if invalid/expired */
export function consumeAuthCode(code: string): Omit<AuthCodeEntry, 'expiresAt'> | null {
  cleanupExpiredCodes();
  const entry = authCodeStore.get(code);
  if (!entry) return null;

  // One-time use: delete immediately
  authCodeStore.delete(code);

  if (entry.expiresAt <= Date.now()) return null;

  const { expiresAt: _, ...data } = entry;
  return data;
}
