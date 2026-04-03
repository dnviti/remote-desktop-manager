import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../types';
import { createStorageArea, installChromeMock } from '../test/chrome';
import { sendMessage } from './apiClient';
import { fetchAccounts, invalidateAccountsCache } from './fetchAccounts';

vi.mock('./apiClient', () => ({
  sendMessage: vi.fn(),
}));

const account: Account = {
  id: 'account-1',
  label: 'Production',
  serverUrl: 'https://arsenale.example.com',
  userId: 'user-1',
  email: 'user@example.com',
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  lastUsed: '2024-01-01T00:00:00.000Z',
  vaultUnlocked: false,
};

describe('fetchAccounts', () => {
  let local: ReturnType<typeof createStorageArea>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    ({ local } = installChromeMock({ local: { activeAccountId: 'account-1' } }));
    invalidateAccountsCache();
    vi.clearAllMocks();
    vi.mocked(sendMessage).mockResolvedValue({
      success: true,
      data: [account],
    });
  });

  afterEach(() => {
    invalidateAccountsCache();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('caches account fetches within the ttl window', async () => {
    await expect(fetchAccounts()).resolves.toEqual({
      accounts: [account],
      activeId: 'account-1',
    });
    await expect(fetchAccounts()).resolves.toEqual({
      accounts: [account],
      activeId: 'account-1',
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(local.get).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2001);
    await fetchAccounts();

    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('returns an empty account list when the background fetch fails', async () => {
    vi.mocked(sendMessage).mockResolvedValue({
      success: false,
      error: 'boom',
    });

    await expect(fetchAccounts()).resolves.toEqual({
      accounts: [],
      activeId: 'account-1',
    });
  });

  it('invalidates the cache explicitly before the ttl expires', async () => {
    await fetchAccounts();

    invalidateAccountsCache();
    await fetchAccounts();

    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
});
