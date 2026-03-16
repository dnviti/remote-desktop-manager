import type { Account, StorageSchema } from '../types';

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

/** Read the full storage schema from chrome.storage.local. */
export async function getStorage(): Promise<StorageSchema> {
  const result = await chrome.storage.local.get([STORAGE_KEY_ACCOUNTS, STORAGE_KEY_ACTIVE]);
  return {
    accounts: (result[STORAGE_KEY_ACCOUNTS] as Account[] | undefined) ?? defaultStorage.accounts,
    activeAccountId: (result[STORAGE_KEY_ACTIVE] as string | null | undefined) ?? defaultStorage.activeAccountId,
  };
}

/** Get all configured accounts. */
export async function getAccounts(): Promise<Account[]> {
  const storage = await getStorage();
  return storage.accounts;
}

/** Get the currently active account, or null. */
export async function getActiveAccount(): Promise<Account | null> {
  const storage = await getStorage();
  if (!storage.activeAccountId) return null;
  return storage.accounts.find((a) => a.id === storage.activeAccountId) ?? null;
}

/** Set the active account by ID. */
export async function setActiveAccountId(id: string | null): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY_ACTIVE]: id });
}

/** Add a new account and make it active. Returns the created account. */
export async function addAccount(
  params: Omit<Account, 'id' | 'lastUsed' | 'vaultUnlocked'>,
): Promise<Account> {
  const storage = await getStorage();
  const account: Account = {
    ...params,
    id: uuid(),
    lastUsed: new Date().toISOString(),
    vaultUnlocked: false,
  };
  storage.accounts.push(account);
  await chrome.storage.local.set({
    [STORAGE_KEY_ACCOUNTS]: storage.accounts,
    [STORAGE_KEY_ACTIVE]: account.id,
  });
  return account;
}

/** Update an existing account (partial merge). */
export async function updateAccount(
  partial: Partial<Account> & { id: string },
): Promise<Account | null> {
  const storage = await getStorage();
  const idx = storage.accounts.findIndex((a) => a.id === partial.id);
  if (idx === -1) return null;
  const updated = { ...storage.accounts[idx], ...partial, lastUsed: new Date().toISOString() };
  storage.accounts[idx] = updated;
  await chrome.storage.local.set({ [STORAGE_KEY_ACCOUNTS]: storage.accounts });
  return updated;
}

/** Remove an account by ID. If the removed account was active, clears the active selection. */
export async function removeAccount(id: string): Promise<void> {
  const storage = await getStorage();
  const filtered = storage.accounts.filter((a) => a.id !== id);
  const updates: Record<string, unknown> = { [STORAGE_KEY_ACCOUNTS]: filtered };
  if (storage.activeAccountId === id) {
    updates[STORAGE_KEY_ACTIVE] = filtered.length > 0 ? filtered[0].id : null;
  }
  await chrome.storage.local.set(updates);
}

/** Touch `lastUsed` for a given account. */
export async function touchAccount(id: string): Promise<void> {
  const storage = await getStorage();
  const account = storage.accounts.find((a) => a.id === id);
  if (account) {
    account.lastUsed = new Date().toISOString();
    await chrome.storage.local.set({ [STORAGE_KEY_ACCOUNTS]: storage.accounts });
  }
}
