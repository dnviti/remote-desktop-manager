import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useVaultStore } from '../store/vaultStore';
import { broadcastVaultWindowSync } from '../utils/vaultWindowSync';
import { useVaultWindowSync } from './useVaultWindowSync';

class MockBroadcastChannel {
  private static channels = new Map<string, Set<MockBroadcastChannel>>();

  private readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();

  constructor(private readonly channelName: string) {
    const channels = MockBroadcastChannel.channels.get(channelName) ?? new Set<MockBroadcastChannel>();
    channels.add(this);
    MockBroadcastChannel.channels.set(channelName, channels);
  }

  postMessage(data: unknown) {
    const channels = MockBroadcastChannel.channels.get(this.channelName) ?? new Set<MockBroadcastChannel>();
    for (const channel of channels) {
      if (channel !== this) {
        channel.emit(data);
      }
    }
  }

  addEventListener(_type: string, listener: (event: MessageEvent<unknown>) => void) {
    this.listeners.add(listener);
  }

  removeEventListener(_type: string, listener: (event: MessageEvent<unknown>) => void) {
    this.listeners.delete(listener);
  }

  close() {
    const channels = MockBroadcastChannel.channels.get(this.channelName);
    channels?.delete(this);
    if (channels?.size === 0) {
      MockBroadcastChannel.channels.delete(this.channelName);
    }
    this.listeners.clear();
  }

  private emit(data: unknown) {
    const event = new MessageEvent('message', { data });
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

const originalBroadcastChannel = window.BroadcastChannel;

describe('useVaultWindowSync', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'BroadcastChannel', {
      configurable: true,
      writable: true,
      value: MockBroadcastChannel,
    });
    useVaultStore.setState({
      unlocked: false,
      initialized: true,
      mfaUnlockAvailable: false,
      mfaUnlockMethods: [],
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'BroadcastChannel', {
      configurable: true,
      writable: true,
      value: originalBroadcastChannel,
    });
  });

  it('applies incoming lock and unlock signals without rebroadcasting', async () => {
    renderHook(() => useVaultWindowSync());

    broadcastVaultWindowSync('unlock');
    await waitFor(() => {
      expect(useVaultStore.getState()).toMatchObject({ unlocked: true, initialized: true });
    });

    broadcastVaultWindowSync('lock');
    await waitFor(() => {
      expect(useVaultStore.getState()).toMatchObject({ unlocked: false, initialized: true });
    });
  });
});
