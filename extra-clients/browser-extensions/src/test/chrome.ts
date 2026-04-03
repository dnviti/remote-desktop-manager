import { vi } from 'vitest';

type StorageState = Record<string, unknown>;

function getValue(state: StorageState, key: string, fallback?: unknown) {
  return Object.prototype.hasOwnProperty.call(state, key) ? state[key] : fallback;
}

function pickKeys(
  state: StorageState,
  keys?: string | string[] | StorageState | null,
): StorageState {
  if (keys == null) return { ...state };

  if (typeof keys === 'string') {
    const value = getValue(state, keys);
    return value === undefined ? {} : { [keys]: value };
  }

  if (Array.isArray(keys)) {
    return keys.reduce<StorageState>((result, key) => {
      const value = getValue(state, key);
      if (value !== undefined) result[key] = value;
      return result;
    }, {});
  }

  return Object.entries(keys).reduce<StorageState>((result, [key, fallback]) => {
    result[key] = getValue(state, key, fallback);
    return result;
  }, {});
}

export function createStorageArea(initial: StorageState = {}) {
  const state: StorageState = { ...initial };

  return {
    state,
    get: vi.fn(async (keys?: string | string[] | StorageState | null) => pickKeys(state, keys)),
    set: vi.fn(async (items: StorageState) => {
      Object.assign(state, items);
    }),
    clear: vi.fn(async () => {
      for (const key of Object.keys(state)) {
        Reflect.deleteProperty(state, key);
      }
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        Reflect.deleteProperty(state, key);
      }
    }),
  };
}

export function installChromeMock(options: { local?: StorageState; session?: StorageState } = {}) {
  const local = createStorageArea(options.local);
  const session = createStorageArea(options.session);
  const runtimeListeners: Array<(message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => boolean | undefined> = [];
  const alarmListeners: Array<(alarm: chrome.alarms.Alarm) => undefined | Promise<void>> = [];
  const runtime = {
    lastError: null as { message?: string } | null,
    sendMessage: vi.fn(),
    openOptionsPage: vi.fn(async () => undefined),
    getURL: vi.fn((path = '') => `chrome-extension://test/${path}`),
    onMessage: {
      addListener: vi.fn((listener: (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => boolean | undefined) => {
        runtimeListeners.push(listener);
      }),
    },
  };
  const alarms = {
    create: vi.fn(),
    clear: vi.fn(async () => true),
    onAlarm: {
      addListener: vi.fn((listener: (alarm: chrome.alarms.Alarm) => undefined | Promise<void>) => {
        alarmListeners.push(listener);
      }),
    },
  };
  const action = {
    setBadgeText: vi.fn(async () => undefined),
    setBadgeBackgroundColor: vi.fn(async () => undefined),
    openPopup: vi.fn(async () => undefined),
  };
  const tabs = {
    create: vi.fn(async () => ({ id: 1 })),
    get: vi.fn(async (tabId: number) => ({ id: tabId, url: 'https://example.com' })),
    query: vi.fn(async (): Promise<chrome.tabs.Tab[]> => []),
    sendMessage: vi.fn(async () => undefined),
    onUpdated: {
      addListener: vi.fn(),
    },
    onActivated: {
      addListener: vi.fn(),
    },
  };
  const offscreen = {
    createDocument: vi.fn(async () => undefined),
    closeDocument: vi.fn(async () => undefined),
    Reason: {
      CLIPBOARD: 'CLIPBOARD',
    },
  };

  vi.stubGlobal(
    'chrome',
    {
      storage: { local, session },
      runtime,
      alarms,
      action,
      tabs,
      offscreen,
    } as unknown as typeof chrome
  );

  return {
    local,
    session,
    runtime,
    alarms,
    action,
    tabs,
    offscreen,
    runtimeListeners,
    alarmListeners,
  };
}
