import { create } from 'zustand';
import { ConnectionData } from '../api/connections.api';
import { getPersistedTabs, syncPersistedTabs, clearPersistedTabs, PersistedTab } from '../api/tabs.api';
import { addRecentConnection } from '../utils/recentConnections';
import { useAuthStore } from './authStore';

export interface CredentialOverride {
  username: string;
  password: string;
  domain?: string;
  credentialMode?: 'saved' | 'domain' | 'manual';
}

export interface Tab {
  id: string;
  connection: ConnectionData;
  active: boolean;
  credentials?: CredentialOverride;
}

interface TabsState {
  tabs: Tab[];
  activeTabId: string | null;
  recentTick: number;
  openTab: (connection: ConnectionData, credentials?: CredentialOverride) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  restoreTabs: (connections: ConnectionData[]) => Promise<void>;
  clearAll: () => Promise<void>;
}

// Module-level debounce handle (not part of Zustand state)
let syncTimer: ReturnType<typeof setTimeout> | null = null;
const SYNC_DEBOUNCE_MS = 1000;

// Guard against double-restore
let tabsRestored = false;

function toPersistedTabs(tabs: Tab[], activeTabId: string | null): PersistedTab[] {
  return tabs
    .filter((t) => !t.credentials)
    .map((t, index) => ({
      connectionId: t.connection.id,
      sortOrder: index,
      isActive: t.id === activeTabId,
    }));
}

function scheduleSyncToServer() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const { tabs, activeTabId } = useTabsStore.getState();
    const payload = toPersistedTabs(tabs, activeTabId);
    syncPersistedTabs(payload).catch(() => {
      // Silently ignore sync failures — tabs work fine in-memory
    });
  }, SYNC_DEBOUNCE_MS);
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  recentTick: 0,

  openTab: (connection, credentials) => {
    const { tabs } = get();

    // Track as recent
    const userId = useAuthStore.getState().user?.id;
    if (userId) {
      addRecentConnection(userId, connection.id);
    }

    // Only reuse existing tab when no credential override
    if (!credentials) {
      const existing = tabs.find((t) => t.connection.id === connection.id);
      if (existing) {
        set((state) => ({ activeTabId: existing.id, recentTick: state.recentTick + 1 }));
        scheduleSyncToServer();
        return;
      }
    }

    const tabId = `tab-${connection.id}-${Date.now()}`;
    const newTab: Tab = { id: tabId, connection, active: true, credentials };
    set((state) => ({
      tabs: [...tabs.map((t) => ({ ...t, active: false })), newTab],
      activeTabId: tabId,
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

    set({
      tabs: filtered.map((t) => ({
        ...t,
        active: t.id === newActiveId,
      })),
      activeTabId: newActiveId,
    });
    scheduleSyncToServer();
  },

  setActiveTab: (tabId) => {
    set((state) => ({
      activeTabId: tabId,
      tabs: state.tabs.map((t) => ({ ...t, active: t.id === tabId })),
    }));
    scheduleSyncToServer();
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

      const activeConnectionId =
        validTabs.find((p) => p.isActive)?.connectionId ?? validTabs[validTabs.length - 1].connectionId;

      const restoredTabs: Tab[] = validTabs.map((p) => {
        const connection = connMap.get(p.connectionId)!;
        const tabId = `tab-${connection.id}-${Date.now()}`;
        return {
          id: tabId,
          connection,
          active: connection.id === activeConnectionId,
        };
      });

      const newActiveId = restoredTabs.find((t) => t.active)?.id ?? null;

      set({ tabs: restoredTabs, activeTabId: newActiveId });
      // No sync after restore — the server already has this state
    } catch {
      // Silently ignore restore failures
    }
  },

  clearAll: async () => {
    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }
    tabsRestored = false;
    set({ tabs: [], activeTabId: null });
    try {
      await clearPersistedTabs();
    } catch {
      // Ignore — tab clear on logout is best-effort
    }
  },
}));
