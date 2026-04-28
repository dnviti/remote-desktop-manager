import { act, renderHook, waitFor } from '@testing-library/react';
import {
  createDbSession,
  dbSessionHeartbeat,
  endDbSession,
  updateDbSessionConfig,
} from '../../api/database.api';
import { useDatabaseSessionController } from './useDatabaseSessionController';

vi.mock('../../api/database.api', () => ({
  createDbSession: vi.fn(),
  dbSessionHeartbeat: vi.fn(),
  endDbSession: vi.fn(),
  updateDbSessionConfig: vi.fn(),
}));

const createDbSessionMock = vi.mocked(createDbSession);
const heartbeatMock = vi.mocked(dbSessionHeartbeat);
const endDbSessionMock = vi.mocked(endDbSession);
const updateConfigMock = vi.mocked(updateDbSessionConfig);

describe('useDatabaseSessionController', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    createDbSessionMock.mockResolvedValue({
      sessionId: 'session-1',
      proxyHost: '127.0.0.1',
      proxyPort: 5432,
      protocol: 'postgresql',
      databaseName: 'app',
      username: 'postgres',
    });
    heartbeatMock.mockResolvedValue({ ok: true });
    endDbSessionMock.mockResolvedValue({ ok: true });
    updateConfigMock.mockResolvedValue({ applied: true, activeDatabase: 'app' });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('creates a session and applies protocol defaults behind the workspace seam', async () => {
    const onSessionConfigChange = vi.fn();

    const { result, unmount } = renderHook(() => useDatabaseSessionController({
      connectionId: 'conn-1',
      currentSessionConfig: {},
      onSessionConfigChange,
    }));

    await waitFor(() => expect(result.current.connectionState).toBe('connected'));

    expect(result.current.sessionId).toBe('session-1');
    expect(result.current.protocol).toBe('postgresql');
    expect(result.current.databaseName).toBe('app');
    expect(onSessionConfigChange).toHaveBeenCalledWith(expect.objectContaining({
      activeDatabase: 'app',
      searchPath: 'public',
    }));
    expect(updateConfigMock).toHaveBeenCalledWith('session-1', expect.objectContaining({
      activeDatabase: 'app',
      searchPath: 'public',
    }));

    unmount();

    await waitFor(() => expect(endDbSessionMock).toHaveBeenCalledWith('session-1'));
  });

  it('passes stored session config to session creation without rewriting defaults', async () => {
    const onSessionConfigChange = vi.fn();

    const { unmount } = renderHook(() => useDatabaseSessionController({
      connectionId: 'conn-1',
      currentSessionConfig: { activeDatabase: 'analytics' },
      onSessionConfigChange,
    }));

    await waitFor(() => expect(createDbSessionMock).toHaveBeenCalledWith({
      connectionId: 'conn-1',
      sessionConfig: { activeDatabase: 'analytics' },
    }));

    expect(onSessionConfigChange).not.toHaveBeenCalled();
    expect(updateConfigMock).not.toHaveBeenCalled();

    unmount();
  });

  it('turns recoverable lost-session statuses into reconnect state', async () => {
    const onSessionConfigChange = vi.fn();

    const { result, unmount } = renderHook(() => useDatabaseSessionController({
      connectionId: 'conn-1',
      currentSessionConfig: {},
      onSessionConfigChange,
    }));

    await waitFor(() => expect(result.current.connectionState).toBe('connected'));

    act(() => {
      expect(result.current.handleRecoverableSessionError(410)).toBe(true);
    });

    expect(result.current.sessionId).toBeNull();
    await waitFor(() => expect(result.current.reconnectState).toBe('reconnecting'));

    unmount();
  });
});
