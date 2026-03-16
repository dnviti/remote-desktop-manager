import type { Account } from '../types';
import { sendMessage } from './apiClient';

/** Cached result shape. */
interface AccountsCacheEntry {
  accounts: Account[];
  activeId: string | null;
  timestamp: number;
}

/** Cache TTL in milliseconds (2 seconds). */
const CACHE_TTL_MS = 2_000;

/** In-memory cache for the last fetchAccounts result. */
let cache: AccountsCacheEntry | null = null;

/**
 * Fetch accounts and the active account ID, with a short-lived in-memory cache
 * to deduplicate redundant chrome.storage.local reads across components.
 *
 * Returns the cached value if it was fetched within the last {@link CACHE_TTL_MS} ms.
 */
export async function fetchAccounts(): Promise<{ accounts: Account[]; activeId: string | null }> {
  const now = Date.now();
  if (cache && now - cache.timestamp < CACHE_TTL_MS) {
    return { accounts: cache.accounts, activeId: cache.activeId };
  }

  const res = await sendMessage<Account[]>({ type: 'GET_ACCOUNTS' });
  const accounts = res.success && res.data ? res.data : [];
  const storage = await chrome.storage.local.get('activeAccountId');
  const activeId = (storage['activeAccountId'] as string | null | undefined) ?? null;

  cache = { accounts, activeId, timestamp: Date.now() };
  return { accounts, activeId };
}

/**
 * Invalidate the in-memory accounts cache.
 *
 * Must be called after any mutation to account data (add, update, remove, etc.)
 * so that the next fetchAccounts() call reads fresh data from storage.
 */
export function invalidateAccountsCache(): void {
  cache = null;
}
