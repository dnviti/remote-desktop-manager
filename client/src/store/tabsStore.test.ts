import type { ConnectionData } from '../api/connections.api';
import type { PersistedTab } from '../api/tabs.api';
import { clearPersistedTabs, getPersistedTabs, syncPersistedTabs } from '../api/tabs.api';
import { addRecentConnection } from '../utils/recentConnections';
import { useAuthStore } from './authStore';
import { useTabsStore } from './tabsStore';

vi.mock('../api/tabs.api', () => ({
  getPersistedTabs: vi.fn(),
  syncPersistedTabs: vi.fn(),
  clearPersistedTabs: vi.fn(),
}));

vi.mock('../utils/recentConnections', () => ({
  addRecentConnection: vi.fn(),
}));

function makeConnection(id: string): ConnectionData {
  return {
    id,
    name: `Connection ${id}`,
    type: 'SSH',
    host: `${id}.example.com`,
    port: 22,
    folderId: null,
    description: null,
    isFavorite: false,
    enableDrive: false,
    isOwner: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

function makeTypedConnection(id: string, type: ConnectionData['type']): ConnectionData {
  return { ...makeConnection(id), type };
}

describe('useTabsStore', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    useAuthStore.setState({
      accessToken: null,
      csrfToken: null,
      user: null,
      isAuthenticated: false,
    });
    useTabsStore.setState({ tabs: [], activeTabId: null, recentTick: 0 });
    vi.clearAllMocks();
    vi.mocked(getPersistedTabs).mockResolvedValue([]);
    vi.mocked(syncPersistedTabs).mockResolvedValue([]);
    vi.mocked(clearPersistedTabs).mockResolvedValue();
    await useTabsStore.getState().clearAll();
    useTabsStore.setState({ tabs: [], activeTabId: null, recentTick: 0 });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens a tab, tracks recents, and syncs persisted tabs after the debounce window', async () => {
    useAuthStore.setState({
      accessToken: 'token',
      csrfToken: 'csrf',
      user: {
        id: 'user-1',
        email: 'user@example.com',
        username: 'user',
        avatarData: null,
      },
      isAuthenticated: true,
    });
    const connection = makeConnection('conn-1');

    useTabsStore.getState().openTab(connection);

    const state = useTabsStore.getState();
    expect(addRecentConnection).toHaveBeenCalledWith('user-1', 'conn-1');
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]).toMatchObject({ connection, active: true });
    expect(state.activeTabId).toBe(state.tabs[0]?.id);

    await vi.advanceTimersByTimeAsync(1000);

    expect(syncPersistedTabs).toHaveBeenCalledWith([
      {
        connectionId: 'conn-1',
        sortOrder: 0,
        isActive: true,
      },
    ]);
  });

  it('opens duplicate non-RDP tabs for the same connection', () => {
    const sshConnection = makeTypedConnection('conn-1', 'SSH');
    const dbConnection = makeTypedConnection('conn-2', 'DATABASE');

    useTabsStore.getState().openTab(sshConnection);
    useTabsStore.getState().openTab(sshConnection);
    useTabsStore.getState().openTab(dbConnection);
    useTabsStore.getState().openTab(dbConnection);

    expect(useTabsStore.getState().tabs.map((tab) => `${tab.connection.type}:${tab.connection.id}`)).toEqual([
      'SSH:conn-1',
      'SSH:conn-1',
      'DATABASE:conn-2',
      'DATABASE:conn-2',
    ]);
  });

  it('focuses an existing RDP tab when the same connection and username are opened again', () => {
    const connection = makeTypedConnection('conn-1', 'RDP');

    useTabsStore.getState().openTab(connection, {
      username: 'root',
      password: 'secret',
      credentialMode: 'manual',
    });
    const firstTabId = useTabsStore.getState().tabs[0]?.id;

    useTabsStore.getState().openTab(connection, {
      username: 'ROOT',
      password: 'secret-2',
      credentialMode: 'manual',
    });

    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(useTabsStore.getState().activeTabId).toBe(firstTabId);
  });

  it('opens a second RDP tab when the username differs', () => {
    const connection = makeTypedConnection('conn-1', 'RDP');

    useTabsStore.getState().openTab(connection, {
      username: 'root',
      password: 'secret',
      credentialMode: 'manual',
    });
    useTabsStore.getState().openTab(connection, {
      username: 'admin',
      password: 'secret',
      credentialMode: 'manual',
    });

    expect(useTabsStore.getState().tabs).toHaveLength(2);
  });

  it('updates resolved RDP identity and uses it for later matching', () => {
    const connection = makeTypedConnection('conn-1', 'RDP');

    useTabsStore.getState().openTab(connection);
    const firstTabId = useTabsStore.getState().tabs[0]?.id as string;
    useTabsStore.getState().setRdpIdentity(firstTabId, 'resolved-user', 'corp');

    useTabsStore.getState().openTab(connection, {
      username: 'resolved-user',
      password: 'secret',
      domain: 'CORP',
      credentialMode: 'manual',
    });

    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(useTabsStore.getState().activeTabId).toBe(firstTabId);
  });

  it('closes the active tab and allows switching the active tab explicitly', () => {
    useTabsStore.getState().openTab(makeConnection('conn-1'));
    vi.setSystemTime(new Date('2024-01-01T00:00:01.000Z'));
    useTabsStore.getState().openTab(makeConnection('conn-2'));
    vi.setSystemTime(new Date('2024-01-01T00:00:02.000Z'));
    useTabsStore.getState().openTab(makeConnection('conn-3'));

    const [firstTab, secondTab, thirdTab] = useTabsStore.getState().tabs.map((tab) => tab.id);

    useTabsStore.getState().closeTab(thirdTab as string);
    expect(useTabsStore.getState().activeTabId).toBe(secondTab);

    useTabsStore.getState().setActiveTab(firstTab as string);
    expect(useTabsStore.getState().activeTabId).toBe(firstTab);
    expect(useTabsStore.getState().tabs.map((tab) => ({ id: tab.id, active: tab.active }))).toEqual([
      { id: firstTab, active: true },
      { id: secondTab, active: false },
    ]);
  });

  it('restores persisted tabs in order and ignores missing connections', async () => {
    const persisted: PersistedTab[] = [
      { connectionId: 'missing', sortOrder: 0, isActive: false },
      { connectionId: 'conn-2', sortOrder: 2, isActive: false },
      { connectionId: 'conn-1', sortOrder: 1, isActive: true },
    ];
    vi.mocked(getPersistedTabs).mockResolvedValue(persisted);

    await useTabsStore
      .getState()
      .restoreTabs([makeConnection('conn-1'), makeConnection('conn-2')]);

    const state = useTabsStore.getState();
    expect(state.tabs.map((tab) => tab.connection.id)).toEqual(['conn-1', 'conn-2']);
    expect(state.tabs.find((tab) => tab.id === state.activeTabId)?.connection.id).toBe('conn-1');
    expect(syncPersistedTabs).not.toHaveBeenCalled();
  });

  it('sets and clears db tunnel metadata on an existing tab', () => {
    useTabsStore.getState().openTab(makeConnection('conn-1'));
    const tabId = useTabsStore.getState().tabs[0]?.id as string;

    useTabsStore.getState().setDbTunnel(tabId, {
      tunnelId: 'tunnel-1',
      sessionId: 'session-1',
      localHost: '127.0.0.1',
      localPort: 5432,
      connectionString: 'postgresql://127.0.0.1:5432/db',
      targetDbHost: 'db.internal',
      targetDbPort: 5432,
      dbType: 'postgresql',
      healthy: true,
    });
    expect(useTabsStore.getState().tabs[0]?.dbTunnel).toMatchObject({
      tunnelId: 'tunnel-1',
      dbType: 'postgresql',
      healthy: true,
    });

    useTabsStore.getState().clearDbTunnel(tabId);
    expect(useTabsStore.getState().tabs[0]?.dbTunnel).toBeUndefined();
  });

  it('clears all tabs, clears persisted state, and resets restore bookkeeping', async () => {
    const connection = makeConnection('conn-1');
    useTabsStore.getState().openTab(connection);

    await useTabsStore.getState().clearAll();

    expect(clearPersistedTabs).toHaveBeenCalled();
    expect(useTabsStore.getState()).toMatchObject({
      tabs: [],
      activeTabId: null,
    });

    vi.mocked(getPersistedTabs).mockResolvedValue([
      { connectionId: 'conn-1', sortOrder: 0, isActive: true },
    ]);
    await useTabsStore.getState().restoreTabs([connection]);

    expect(useTabsStore.getState().tabs).toHaveLength(1);
  });
});
