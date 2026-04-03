import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../types';
import { createStorageArea, installChromeMock } from '../test/chrome';
import { invalidateAccountsCache } from './fetchAccounts';
import {
  addAccount,
  getStorage,
  removeAccount,
  setActiveAccountId,
  touchAccount,
  updateAccount,
} from './accountStore';

vi.mock('./tokenEncryption', () => ({
  encryptToken: vi.fn(async (value: string) => `enc(${value})`),
  decryptToken: vi.fn(async (value: string) =>
    value.startsWith('enc(') ? value.slice(4, -1) : value
  ),
  getOrCreateKey: vi.fn(async () => ({ id: 'key-1' } as unknown as CryptoKey)),
  isEncryptedToken: vi.fn((value: string) => value.startsWith('enc(')),
}));

vi.mock('./fetchAccounts', () => ({
  invalidateAccountsCache: vi.fn(),
}));

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'account-1',
    label: 'Production',
    serverUrl: 'https://arsenale.example.com',
    userId: 'user-1',
    email: 'user@example.com',
    accessToken: 'enc(access-token)',
    refreshToken: 'enc(refresh-token)',
    lastUsed: '2024-01-01T00:00:00.000Z',
    vaultUnlocked: false,
    ...overrides,
  };
}

describe('accountStore', () => {
  let local: ReturnType<typeof createStorageArea>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-02T03:04:05.000Z'));
    ({ local } = installChromeMock());
    vi.stubGlobal(
      'crypto',
      {
        randomUUID: vi.fn(() => 'generated-id'),
      } as unknown as Crypto
    );
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns decrypted storage and migrates plaintext tokens in place', async () => {
    local.state.accounts = [
      makeAccount({
        accessToken: 'plain-access',
        refreshToken: 'plain-refresh',
      }),
    ];
    local.state.activeAccountId = 'account-1';

    await expect(getStorage()).resolves.toEqual({
      accounts: [
        makeAccount({
          accessToken: 'plain-access',
          refreshToken: 'plain-refresh',
        }),
      ],
      activeAccountId: 'account-1',
    });

    expect((local.state.accounts as Account[])[0]).toMatchObject({
      accessToken: 'enc(plain-access)',
      refreshToken: 'enc(plain-refresh)',
    });
  });

  it('adds a new account, encrypts tokens before persistence, and makes it active', async () => {
    local.state.accounts = [makeAccount()];

    const created = await addAccount({
      label: 'Staging',
      serverUrl: 'https://staging.example.com',
      userId: 'user-2',
      email: 'staging@example.com',
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    });

    expect(created).toMatchObject({
      id: 'generated-id',
      label: 'Staging',
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      lastUsed: '2024-01-02T03:04:05.000Z',
      vaultUnlocked: false,
    });
    expect(local.state.activeAccountId).toBe('generated-id');
    expect((local.state.accounts as Account[])).toEqual([
      makeAccount(),
      expect.objectContaining({
        id: 'generated-id',
        accessToken: 'enc(new-access)',
        refreshToken: 'enc(new-refresh)',
      }),
    ]);
    expect(invalidateAccountsCache).toHaveBeenCalled();
  });

  it('returns null when updating a missing account', async () => {
    local.state.accounts = [makeAccount()];

    await expect(updateAccount({ id: 'missing-account', label: 'Nope' })).resolves.toBeNull();

    expect(local.state.accounts).toEqual([makeAccount()]);
    expect(invalidateAccountsCache).not.toHaveBeenCalled();
  });

  it('updates an existing account and persists re-encrypted tokens', async () => {
    local.state.accounts = [makeAccount()];

    const updated = await updateAccount({
      id: 'account-1',
      label: 'Renamed',
      vaultUnlocked: true,
    });

    expect(updated).toMatchObject({
      id: 'account-1',
      label: 'Renamed',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      vaultUnlocked: true,
      lastUsed: '2024-01-02T03:04:05.000Z',
    });
    expect((local.state.accounts as Account[])[0]).toMatchObject({
      id: 'account-1',
      label: 'Renamed',
      accessToken: 'enc(access-token)',
      refreshToken: 'enc(refresh-token)',
      vaultUnlocked: true,
    });
    expect(invalidateAccountsCache).toHaveBeenCalled();
  });

  it('reassigns the active account when the current active account is removed', async () => {
    local.state.accounts = [
      makeAccount({ id: 'account-1' }),
      makeAccount({
        id: 'account-2',
        label: 'Secondary',
        accessToken: 'enc(second-access)',
        refreshToken: 'enc(second-refresh)',
      }),
    ];
    local.state.activeAccountId = 'account-1';

    await removeAccount('account-1');

    expect((local.state.accounts as Account[]).map((account) => account.id)).toEqual([
      'account-2',
    ]);
    expect(local.state.activeAccountId).toBe('account-2');
    expect(invalidateAccountsCache).toHaveBeenCalled();
  });

  it('touches usage metadata and supports explicit active-account changes', async () => {
    local.state.accounts = [makeAccount()];

    await touchAccount('account-1');
    expect((local.state.accounts as Account[])[0]?.lastUsed).toBe('2024-01-02T03:04:05.000Z');

    await setActiveAccountId('account-1');
    expect(local.state.activeAccountId).toBe('account-1');
    expect(invalidateAccountsCache).toHaveBeenCalled();
  });
});
