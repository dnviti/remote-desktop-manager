import { useCallback, useEffect, useRef, useState } from 'react';
import type { CredentialOverride } from '../../store/tabsStore';
import type { DbSessionConfig } from '../../api/database.api';
import {
  createDbSession,
  dbSessionHeartbeat,
  endDbSession,
  updateDbSessionConfig,
} from '../../api/database.api';
import { extractApiError } from '../../utils/apiError';
import { useAutoReconnect } from '../../hooks/useAutoReconnect';
import type { DbConnectionState } from './DbConnectionStatus';
import { defaultSessionConfigForProtocol } from './dbWorkspaceBehavior';

interface UseDatabaseSessionControllerOptions {
  connectionId: string;
  credentials?: CredentialOverride;
  currentSessionConfig: DbSessionConfig;
  initialProtocol?: string;
  onSessionConfigChange: (config: DbSessionConfig) => void;
}

export function useDatabaseSessionController({
  connectionId,
  credentials,
  currentSessionConfig,
  initialProtocol,
  onSessionConfigChange,
}: UseDatabaseSessionControllerOptions) {
  const mountedRef = useRef(true);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const wasConnectedRef = useRef(false);
  const currentSessionConfigRef = useRef(currentSessionConfig);
  const triggerReconnectRef = useRef<() => void>(() => {});

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<DbConnectionState>('connecting');
  const [error, setError] = useState('');
  const [protocol, setProtocol] = useState(initialProtocol || 'postgresql');
  const [databaseName, setDatabaseName] = useState<string | undefined>();

  useEffect(() => {
    currentSessionConfigRef.current = currentSessionConfig;
  }, [currentSessionConfig]);

  const clearHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const clearCurrentSession = useCallback(() => {
    sessionIdRef.current = null;
    setSessionId(null);
  }, []);

  const connectSession = useCallback(async () => {
    clearHeartbeat();
    setConnectionState('connecting');
    setError('');

    const sessionConfig = currentSessionConfigRef.current;
    const result = await createDbSession({
      connectionId,
      ...(credentials && {
        username: credentials.username,
        password: credentials.password,
      }),
      ...(Object.keys(sessionConfig).length > 0 && { sessionConfig }),
    });

    if (!mountedRef.current) {
      endDbSession(result.sessionId).catch(() => {});
      return;
    }

    sessionIdRef.current = result.sessionId;
    setSessionId(result.sessionId);
    setProtocol(result.protocol);
    setDatabaseName(result.databaseName);
    setConnectionState('connected');
    wasConnectedRef.current = true;

    if (Object.keys(sessionConfig).length === 0) {
      const defaults = defaultSessionConfigForProtocol(result.protocol, result.databaseName);
      if (Object.keys(defaults).length > 0) {
        onSessionConfigChange(defaults);
        updateDbSessionConfig(result.sessionId, defaults).catch(() => {});
      }
    }

    heartbeatRef.current = setInterval(() => {
      const activeSessionId = sessionIdRef.current;
      if (!activeSessionId) return;
      dbSessionHeartbeat(activeSessionId).catch((err) => {
        if (err?.response?.status !== 410) return;
        clearHeartbeat();
        clearCurrentSession();
        if (wasConnectedRef.current) {
          setConnectionState('connecting');
          triggerReconnectRef.current();
        }
      });
    }, 15_000);
  }, [clearCurrentSession, clearHeartbeat, connectionId, credentials, onSessionConfigChange]);

  const {
    reconnectState,
    attempt: reconnectAttempt,
    maxRetries: reconnectMaxRetries,
    triggerReconnect,
    cancelReconnect,
    resetReconnect,
  } = useAutoReconnect(connectSession);

  triggerReconnectRef.current = triggerReconnect;

  useEffect(() => {
    if (connectionState === 'connected' && reconnectState === 'reconnecting') {
      resetReconnect();
    }
  }, [connectionState, reconnectState, resetReconnect]);

  useEffect(() => {
    if (reconnectState === 'failed') {
      setConnectionState('error');
      setError('Reconnection failed. Click Retry or close the tab.');
    }
  }, [reconnectState]);

  useEffect(() => {
    mountedRef.current = true;
    connectSession().catch((err) => {
      if (!mountedRef.current) return;
      setConnectionState('error');
      setError(extractApiError(err, 'Failed to connect to database'));
    });

    return () => {
      mountedRef.current = false;
      clearHeartbeat();
      const activeSessionId = sessionIdRef.current;
      if (activeSessionId) {
        endDbSession(activeSessionId).catch(() => {});
      }
      sessionIdRef.current = null;
      cancelReconnect();
    };
    // Reconnects intentionally use latest refs; connection identity controls lifecycle reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  const handleRecoverableSessionError = useCallback((status?: number) => {
    if ((status !== 404 && status !== 410) || !wasConnectedRef.current) {
      return false;
    }
    clearHeartbeat();
    clearCurrentSession();
    setConnectionState('connecting');
    triggerReconnect();
    return true;
  }, [clearCurrentSession, clearHeartbeat, triggerReconnect]);

  const disconnectSession = useCallback(async () => {
    const activeSessionId = sessionIdRef.current;
    if (activeSessionId) {
      await endDbSession(activeSessionId).catch(() => {});
    }
    clearHeartbeat();
    clearCurrentSession();
    setConnectionState('disconnected');
  }, [clearCurrentSession, clearHeartbeat]);

  const retryNow = useCallback(() => {
    resetReconnect();
    connectSession().catch((err) => {
      if (!mountedRef.current) return;
      setConnectionState('error');
      setError(extractApiError(err, 'Reconnection failed'));
    });
  }, [connectSession, resetReconnect]);

  const reportOperationError = useCallback((err: unknown, fallbackMessage: string) => {
    setError(extractApiError(err, fallbackMessage));
  }, []);

  return {
    connectionState,
    error,
    protocol,
    databaseName,
    sessionId,
    reconnectState,
    reconnectAttempt,
    reconnectMaxRetries,
    triggerReconnect,
    setDatabaseName,
    disconnectSession,
    handleRecoverableSessionError,
    reportOperationError,
    retryNow,
  };
}
