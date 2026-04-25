import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  subscribeToVaultWindowSync,
  VAULT_WINDOW_SYNC_STORAGE_KEY,
} from './vaultWindowSync';

const originalBroadcastChannel = window.BroadcastChannel;

describe('vaultWindowSync', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'BroadcastChannel', {
      configurable: true,
      writable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'BroadcastChannel', {
      configurable: true,
      writable: true,
      value: originalBroadcastChannel,
    });
  });

  it('falls back to storage events when BroadcastChannel is unavailable', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToVaultWindowSync(listener);

    window.dispatchEvent(new StorageEvent('storage', {
      key: VAULT_WINDOW_SYNC_STORAGE_KEY,
      newValue: JSON.stringify({
        type: 'vault-sync',
        signal: 'lock',
        timestamp: Date.now(),
        nonce: 'nonce-1',
      }),
    }));

    expect(listener).toHaveBeenCalledWith('lock');

    unsubscribe();
  });
});
