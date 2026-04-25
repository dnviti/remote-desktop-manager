export type VaultWindowSyncSignal = 'lock' | 'unlock';

type VaultWindowSyncMessage = {
  nonce: string;
  signal: VaultWindowSyncSignal;
  timestamp: number;
  type: 'vault-sync';
};

const VAULT_WINDOW_SYNC_CHANNEL = 'arsenale:vault-sync';
export const VAULT_WINDOW_SYNC_STORAGE_KEY = 'arsenale:vault-sync:event';

function hasBroadcastChannel() {
  return typeof window !== 'undefined' && typeof window.BroadcastChannel === 'function';
}

function createVaultWindowSyncMessage(signal: VaultWindowSyncSignal): VaultWindowSyncMessage {
  return {
    type: 'vault-sync',
    signal,
    timestamp: Date.now(),
    nonce: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };
}

function parseVaultWindowSyncMessage(raw: unknown): VaultWindowSyncMessage | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const candidate = raw as Partial<VaultWindowSyncMessage>;
  if (
    candidate.type !== 'vault-sync'
    || (candidate.signal !== 'lock' && candidate.signal !== 'unlock')
    || typeof candidate.timestamp !== 'number'
    || typeof candidate.nonce !== 'string'
  ) {
    return null;
  }

  return {
    type: candidate.type,
    signal: candidate.signal,
    timestamp: candidate.timestamp,
    nonce: candidate.nonce,
  };
}

function parseVaultWindowSyncStorageValue(raw: string): VaultWindowSyncMessage | null {
  try {
    return parseVaultWindowSyncMessage(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function broadcastVaultWindowSync(signal: VaultWindowSyncSignal) {
  if (typeof window === 'undefined') {
    return;
  }

  const message = createVaultWindowSyncMessage(signal);

  if (hasBroadcastChannel()) {
    const channel = new window.BroadcastChannel(VAULT_WINDOW_SYNC_CHANNEL);
    channel.postMessage(message);
    channel.close();
    return;
  }

  try {
    window.localStorage.setItem(VAULT_WINDOW_SYNC_STORAGE_KEY, JSON.stringify(message));
  } catch {
    // Ignore storage write failures so local window behavior still succeeds.
  }
}

export function subscribeToVaultWindowSync(listener: (signal: VaultWindowSyncSignal) => void) {
  if (typeof window === 'undefined') {
    return () => {};
  }

  if (hasBroadcastChannel()) {
    const channel = new window.BroadcastChannel(VAULT_WINDOW_SYNC_CHANNEL);
    const handleMessage = (event: MessageEvent<unknown>) => {
      const message = parseVaultWindowSyncMessage(event.data);
      if (message) {
        listener(message.signal);
      }
    };
    channel.addEventListener('message', handleMessage);
    return () => {
      channel.removeEventListener('message', handleMessage);
      channel.close();
    };
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== VAULT_WINDOW_SYNC_STORAGE_KEY || !event.newValue) {
      return;
    }

    const message = parseVaultWindowSyncStorageValue(event.newValue);
    if (message) {
      listener(message.signal);
    }
  };

  window.addEventListener('storage', handleStorage);
  return () => window.removeEventListener('storage', handleStorage);
}
