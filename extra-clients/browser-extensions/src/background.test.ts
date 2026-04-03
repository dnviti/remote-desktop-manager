import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from './types';
import { installChromeMock } from './test/chrome';

const accountStoreMocks = vi.hoisted(() => ({
  getAccounts: vi.fn(),
  getActiveAccount: vi.fn(),
  setActiveAccountId: vi.fn(async () => undefined),
  addAccount: vi.fn(),
  updateAccount: vi.fn(),
  removeAccount: vi.fn(async () => undefined),
  touchAccount: vi.fn(async () => undefined),
}));

vi.mock('./lib/accountStore', () => accountStoreMocks);
vi.mock('./lib/tokenEncryption', () => ({
  getOrCreateKey: vi.fn(async () => ({ id: 'key-1' } as unknown as CryptoKey)),
}));

describe('background', () => {
  let activeAccount: Account;
  let accounts: Account[];
  let chromeMock: ReturnType<typeof installChromeMock>;

  beforeEach(() => {
    vi.resetModules();
    chromeMock = installChromeMock();

    activeAccount = {
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
    accounts = [activeAccount];

    accountStoreMocks.getAccounts.mockImplementation(async () => [...accounts]);
    accountStoreMocks.getActiveAccount.mockImplementation(async () => activeAccount);
    accountStoreMocks.updateAccount.mockImplementation(
      async (partial: Partial<Account> & { id: string }) => {
        accounts = accounts.map((account) => (
          account.id === partial.id
            ? { ...account, ...partial }
            : account
        ));
        activeAccount = accounts[0]!;
        return activeAccount;
      },
    );

    chromeMock.tabs.query.mockResolvedValue([
      { id: 7, url: 'https://login.example.com' },
    ] as chrome.tabs.Tab[]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('broadcasts autofill updates after a successful vault unlock', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ unlocked: true }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [{
            id: 'secret-1',
            name: 'Example Login',
            metadata: { domain: 'example.com' },
          }],
        }),
    );

    const { handleMessage } = await import('./background');
    const result = await handleMessage({
      type: 'API_REQUEST',
      accountId: 'account-1',
      method: 'POST',
      path: '/api/vault/unlock',
      body: { password: 'secret' },
    });

    expect(result).toEqual({
      success: true,
      data: { unlocked: true },
    });
    expect(accountStoreMocks.updateAccount).toHaveBeenCalledWith({
      id: 'account-1',
      vaultUnlocked: true,
    });
    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        type: 'AUTOFILL_VAULT_STATE_CHANGED',
        vaultLocked: false,
      }),
    );
    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        type: 'AUTOFILL_MATCHES_UPDATED',
        matches: expect.arrayContaining([
          expect.objectContaining({ secretId: 'secret-1' }),
        ]),
      }),
    );
  });

  it('creates an offscreen document when the clipboard clear alarm fires', async () => {
    const { alarmListeners, offscreen, runtime } = chromeMock;
    await import('./background');

    expect(alarmListeners).toHaveLength(1);

    await alarmListeners[0]?.({
      name: 'clipboard-clear',
      scheduledTime: Date.now(),
    } as chrome.alarms.Alarm);

    expect(offscreen.createDocument).toHaveBeenCalledWith({
      url: 'chrome-extension://test/offscreen.html',
      reasons: ['CLIPBOARD'],
      justification: 'Clear copied secrets from the clipboard after the timeout expires.',
    });
    expect(runtime.getURL).toHaveBeenCalledWith('offscreen.html');
  });
});
