import { create } from 'zustand';
import { ConnectionData } from '../api/connections.api';
import { getPersistedTabs, syncPersistedTabs, clearPersistedTabs, PersistedTab } from '../api/tabs.api';
import { addRecentConnection } from '../utils/recentConnections';
import { createTabInstanceId } from '../utils/tabInstance';
import { useAuthStore } from './authStore';
import { useUiPreferencesStore } from './uiPreferencesStore';

export interface CredentialOverride {
  username: string;
  password: string;
  domain?: string;
  credentialMode?: 'saved' | 'domain' | 'manual';
}

export interface DbTunnelState {
  tunnelId: string;
  sessionId: string;
  localHost: string;
  localPort: number;
  connectionString: string | null;
  targetDbHost: string;
  targetDbPort: number;
  dbType: string | null;
  healthy: boolean;
}

export interface Tab {
  id: string;
  connection: ConnectionData;
  active: boolean;
  credentials?: CredentialOverride;
  dbTunnel?: DbTunnelState;
  rdpResolvedUsername?: string;
  rdpResolvedDomain?: string;
}

interface TabsState {
  tabs: Tab[];
  activeTabId: string | null;
  persistedActiveTabId: string | null;
  recentTick: number;
  openTab: (connection: ConnectionData, credentials?: CredentialOverride) => void;
  closeTab: (tabId: string) => void;
  moveTab: (tabId: string, targetIndex: number) => void;
  setActiveTab: (tabId: string) => void;
  setRdpIdentity: (tabId: string, username?: string, domain?: string) => void;
  restoreTabs: (connections: ConnectionData[]) => Promise<void>;
  clearAll: () => Promise<void>;
  setDbTunnel: (tabId: string, tunnel: DbTunnelState) => void;
  clearDbTunnel: (tabId: string) => void;
}

// Module-level debounce handle (not part of Zustand state)
let syncTimer: ReturnType<typeof setTimeout> | null = null;
const SYNC_DEBOUNCE_MS = 1000;

// Guard against double-restore
let tabsRestored = false;

function toPersistedTabs(tabs: Tab[], persistedActiveTabId: string | null): PersistedTab[] {
  const persistedTabs = tabs.filter((t) => !t.credentials);
  const resolvedActiveTabId = persistedTabs.some((t) => t.id === persistedActiveTabId)
    ? persistedActiveTabId
    : persistedTabs[persistedTabs.length - 1]?.id ?? null;

  return persistedTabs
    .map((t, index) => ({
      id: t.id,
      connectionId: t.connection.id,
      sortOrder: index,
      isActive: t.id === resolvedActiveTabId,
    }));
}

function scheduleSyncToServer() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const { tabs } = useTabsStore.getState();
    const { persistedActiveTabId } = useTabsStore.getState();
    const payload = toPersistedTabs(tabs, persistedActiveTabId);
    syncPersistedTabs(payload).catch(() => {
      // Silently ignore sync failures — tabs work fine in-memory
    });
  }, SYNC_DEBOUNCE_MS);
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  persistedActiveTabId: null,
  recentTick: 0,

  openTab: (connection, credentials) => {
    const { tabs } = get();

    // Track as recent
    const userId = useAuthStore.getState().user?.id;
    if (userId) {
      addRecentConnection(userId, connection.id);
    }

    const tabId = createTabInstanceId('tab', connection.id);
    const newTab: Tab = { id: tabId, connection, active: true, credentials };
    set((state) => ({
      tabs: [...tabs.map((t) => ({ ...t, active: false })), newTab],
      activeTabId: tabId,
      persistedActiveTabId: credentials ? state.persistedActiveTabId : tabId,
      recentTick: state.recentTick + 1,
    }));
    scheduleSyncToServer();
  },

  closeTab: (tabId) => {
    const { tabs, activeTabId } = get();
    const filtered = tabs.filter((t) => t.id !== tabId);

    let newActiveId = activeTabId;
    if (activeTabId === tabId) {
      newActiveId = filtered.length > 0 ? filtered[filtered.length - 1].id : null;
    }

    const nextPersistedTabs = filtered.filter((t) => !t.credentials);
    const nextPersistedActiveTabId = nextPersistedTabs.some((t) => t.id === get().persistedActiveTabId)
      ? get().persistedActiveTabId
      : nextPersistedTabs[nextPersistedTabs.length - 1]?.id ?? null;

    useUiPreferencesStore.getState().removeDbTabState(tabId);

    set({
      tabs: filtered.map((t) => ({
        ...t,
        active: t.id === newActiveId,
      })),
      activeTabId: newActiveId,
      persistedActiveTabId: nextPersistedActiveTabId,
    });
    scheduleSyncToServer();
  },

  moveTab: (tabId, targetIndex) => {
    set((state) => {
      const currentIndex = state.tabs.findIndex((tab) => tab.id === tabId);
      if (currentIndex < 0) return state;
      const clampedTarget = Math.max(0, Math.min(targetIndex, state.tabs.length - 1));
      if (currentIndex === clampedTarget) return state;
      const nextTabs = [...state.tabs];
      const [moved] = nextTabs.splice(currentIndex, 1);
      if (!moved) return state;
      nextTabs.splice(clampedTarget, 0, moved);
      return { tabs: nextTabs };
    });
    scheduleSyncToServer();
  },

  setActiveTab: (tabId) => {
    const targetTab = get().tabs.find((t) => t.id === tabId);
    set((state) => ({
      activeTabId: tabId,
      persistedActiveTabId: targetTab && !targetTab.credentials ? tabId : state.persistedActiveTabId,
      tabs: state.tabs.map((t) => ({ ...t, active: t.id === tabId })),
    }));
    scheduleSyncToServer();
  },

  setRdpIdentity: (tabId, username, domain) => {
    set((state) => ({
      tabs: state.tabs.map((t) => (
        t.id === tabId
          ? {
              ...t,
              rdpResolvedUsername: username?.trim() || undefined,
              rdpResolvedDomain: domain?.trim() || undefined,
            }
          : t
      )),
    }));
  },

  restoreTabs: async (connections) => {
    if (tabsRestored) return;
    tabsRestored = true;

    try {
      const persisted = await getPersistedTabs();
      if (persisted.length === 0) return;

      const connMap = new Map<string, ConnectionData>();
      connections.forEach((c) => connMap.set(c.id, c));

      const validTabs = persisted
        .filter((p) => connMap.has(p.connectionId))
        .sort((a, b) => a.sortOrder - b.sortOrder);

      if (validTabs.length === 0) return;

      const activeTabId =
        validTabs.find((p) => p.isActive)?.id ?? validTabs[validTabs.length - 1].id;

      const restoredTabs: Tab[] = validTabs.map((p) => {
        const connection = connMap.get(p.connectionId) as ConnectionData;
        return {
          id: p.id || createTabInstanceId('tab', connection.id),
          connection,
          active: p.id === activeTabId,
        };
      });

      const newActiveId = restoredTabs.find((t) => t.active)?.id ?? null;

      set({ tabs: restoredTabs, activeTabId: newActiveId, persistedActiveTabId: newActiveId });
      // No sync after restore — the server already has this state
    } catch {
      // Silently ignore restore failures
    }
  },

  setDbTunnel: (tabId, tunnel) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, dbTunnel: tunnel } : t,
      ),
    }));
  },

  clearDbTunnel: (tabId) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, dbTunnel: undefined } : t,
      ),
    }));
  },

  clearAll: async () => {
    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }
    tabsRestored = false;
    const uiPrefs = useUiPreferencesStore.getState();
    get().tabs.forEach((tab) => uiPrefs.removeDbTabState(tab.id));
    set({ tabs: [], activeTabId: null, persistedActiveTabId: null });
    try {
      await clearPersistedTabs();
    } catch {
      // Ignore — tab clear on logout is best-effort
    }
  },
}));
