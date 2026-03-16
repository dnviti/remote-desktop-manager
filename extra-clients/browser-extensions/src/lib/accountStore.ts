import type { Account, StorageSchema } from '../types';
import {
  encryptToken,
  decryptToken,
  getOrCreateKey,
  isEncryptedToken,
} from './tokenEncryption';
import { invalidateAccountsCache } from './fetchAccounts';

const STORAGE_KEY_ACCOUNTS = 'accounts';
const STORAGE_KEY_ACTIVE = 'activeAccountId';

const defaultStorage: StorageSchema = {
  accounts: [],
  activeAccountId: null,
};

/** Generate a random UUID v4. */
function uuid(): string {
  return crypto.randomUUID();
}

// ── Token encryption helpers ───────────────────────────────────────────

/**
 * Decrypt the accessToken and refreshToken fields of an account.
 * If a token is still plaintext (migration case or key was rotated),
 * it is returned as-is and will be re-encrypted on the next write.
 */
async function decryptAccountTokens(account: Account, key: CryptoKey): Promise<Account> {
  let { accessToken, refreshToken } = account;

  if (isEncryptedToken(accessToken)) {
    try {
      accessToken = await decryptToken(accessToken, key);
    } catch {
      // Decryption failed — key was rotated. Return the raw value;
      // the next updateAccount call will re-encrypt with the new key.
    }
  }

  if (isEncryptedToken(refreshToken)) {
    try {
      refreshToken = await decryptToken(refreshToken, key);
    } catch {
      // Same: key rotation fallback
    }
  }

  return { ...account, accessToken, refreshToken };
}

/**
 * Encrypt the accessToken and refreshToken fields before persisting.
 * Tokens that are already encrypted are re-encrypted with the current key
 * (they should have been decrypted on read, so this is a no-op path).
 */
async function encryptAccountTokens(account: Account, key: CryptoKey): Promise<Account> {
  const accessToken = await encryptToken(account.accessToken, key);
  const refreshToken = await encryptToken(account.refreshToken, key);
  return { ...account, accessToken, refreshToken };
}

/**
 * Read raw accounts from storage, decrypt tokens, and migrate any plaintext
 * tokens by re-encrypting them in-place.
 */
async function readAndMigrateAccounts(): Promise<{ accounts: Account[]; key: CryptoKey }> {
  const result = await chrome.storage.local.get([STORAGE_KEY_ACCOUNTS]);
  const raw = (result[STORAGE_KEY_ACCOUNTS] as Account[] | undefined) ?? [];
  const key = await getOrCreateKey();

  let needsMigration = false;
  const decrypted: Account[] = [];

  for (const account of raw) {
    const wasPlaintextAccess = !isEncryptedToken(account.accessToken);
    const wasPlaintextRefresh = !isEncryptedToken(account.refreshToken);
    const dec = await decryptAccountTokens(account, key);
    decrypted.push(dec);

    if (wasPlaintextAccess || wasPlaintextRefresh) {
      needsMigration = true;
    }
  }

  // Migrate: encrypt any plaintext tokens that were found
  if (needsMigration) {
    const encrypted: Account[] = [];
    for (const account of decrypted) {
      encrypted.push(await encryptAccountTokens(account, key));
    }
    await chrome.storage.local.set({ [STORAGE_KEY_ACCOUNTS]: encrypted });
  }

  return { accounts: decrypted, key };
}

// ── Public API ─────────────────────────────────────────────────────────

/** Read the full storage schema from chrome.storage.local (tokens decrypted). */
export async function getStorage(): Promise<StorageSchema> {
  const result = await chrome.storage.local.get([STORAGE_KEY_ACCOUNTS, STORAGE_KEY_ACTIVE]);
  const activeAccountId =
    (result[STORAGE_KEY_ACTIVE] as string | null | undefined) ?? defaultStorage.activeAccountId;

  const { accounts } = await readAndMigrateAccounts();

  return { accounts, activeAccountId };
}

/** Get all configured accounts (tokens decrypted). */
export async function getAccounts(): Promise<Account[]> {
  const { accounts } = await readAndMigrateAccounts();
  return accounts;
}

/** Get the currently active account, or null (tokens decrypted). */
export async function getActiveAccount(): Promise<Account | null> {
  const storage = await getStorage();
  if (!storage.activeAccountId) return null;
  return storage.accounts.find((a) => a.id === storage.activeAccountId) ?? null;
}

/** Set the active account by ID. */
export async function setActiveAccountId(id: string | null): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY_ACTIVE]: id });
  invalidateAccountsCache();
}

/** Add a new account and make it active. Returns the created account (tokens decrypted). */
export async function addAccount(
  params: Omit<Account, 'id' | 'lastUsed' | 'vaultUnlocked'>,
): Promise<Account> {
  const { accounts, key } = await readAndMigrateAccounts();
  const account: Account = {
    ...params,
    id: uuid(),
    lastUsed: new Date().toISOString(),
    vaultUnlocked: false,
  };

  // Encrypt the new account's tokens before persisting
  const encrypted = await encryptAccountTokens(account, key);
  // Also re-encrypt existing accounts to ensure consistency
  const encryptedAll: Account[] = [];
  for (const a of accounts) {
    encryptedAll.push(await encryptAccountTokens(a, key));
  }
  encryptedAll.push(encrypted);

  await chrome.storage.local.set({
    [STORAGE_KEY_ACCOUNTS]: encryptedAll,
    [STORAGE_KEY_ACTIVE]: account.id,
  });

  invalidateAccountsCache();
  // Return the account with plaintext tokens (caller needs them)
  return account;
}

/** Update an existing account (partial merge). Returns updated account with decrypted tokens. */
export async function updateAccount(
  partial: Partial<Account> & { id: string },
): Promise<Account | null> {
  const { accounts, key } = await readAndMigrateAccounts();
  const idx = accounts.findIndex((a) => a.id === partial.id);
  if (idx === -1) return null;

  const updated = { ...accounts[idx], ...partial, lastUsed: new Date().toISOString() };
  accounts[idx] = updated;

  // Re-encrypt all accounts before persisting
  const encrypted: Account[] = [];
  for (const a of accounts) {
    encrypted.push(await encryptAccountTokens(a, key));
  }
  await chrome.storage.local.set({ [STORAGE_KEY_ACCOUNTS]: encrypted });
  invalidateAccountsCache();

  return updated;
}

/** Remove an account by ID. If the removed account was active, clears the active selection. */
export async function removeAccount(id: string): Promise<void> {
  const { accounts, key } = await readAndMigrateAccounts();
  const filtered = accounts.filter((a) => a.id !== id);

  // Re-encrypt remaining accounts
  const encrypted: Account[] = [];
  for (const a of filtered) {
    encrypted.push(await encryptAccountTokens(a, key));
  }

  const result = await chrome.storage.local.get([STORAGE_KEY_ACTIVE]);
  const activeAccountId = result[STORAGE_KEY_ACTIVE] as string | null | undefined;

  const updates: Record<string, unknown> = { [STORAGE_KEY_ACCOUNTS]: encrypted };
  if (activeAccountId === id) {
    updates[STORAGE_KEY_ACTIVE] = filtered.length > 0 ? filtered[0].id : null;
  }
  await chrome.storage.local.set(updates);
  invalidateAccountsCache();
}

/** Touch `lastUsed` for a given account. */
export async function touchAccount(id: string): Promise<void> {
  const { accounts, key } = await readAndMigrateAccounts();
  const account = accounts.find((a) => a.id === id);
  if (account) {
    account.lastUsed = new Date().toISOString();
    const encrypted: Account[] = [];
    for (const a of accounts) {
      encrypted.push(await encryptAccountTokens(a, key));
    }
    await chrome.storage.local.set({ [STORAGE_KEY_ACCOUNTS]: encrypted });
    invalidateAccountsCache();
  }
}
