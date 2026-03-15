import { useEffect, useRef, useState, useCallback } from 'react';
import { Box, CircularProgress, Typography, Alert } from '@mui/material';
import * as Guacamole from '@glokon/guacamole-common-js';
import { io } from 'socket.io-client';
import api from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import type { CredentialOverride } from '../../store/tabsStore';
import type { ResolvedDlpPolicy } from '../../api/connections.api';
import FileBrowser from './FileBrowser';
import DockedToolbar from '../shared/DockedToolbar';
import ReconnectOverlay from '../shared/ReconnectOverlay';
import { extractApiError } from '../../utils/apiError';
import { useAutoReconnect } from '../../hooks/useAutoReconnect';
import { useKeyboardCapture } from '../../hooks/useKeyboardCapture';
import { useGuacToolbarActions } from '../../hooks/useGuacToolbarActions';
import { isGuacPermanentError } from '../../utils/reconnectClassifier';

interface RdpViewerProps {
  connectionId: string;
  tabId: string;
  isActive?: boolean;
  enableDrive?: boolean;
  credentials?: CredentialOverride;
}

export default function RdpViewer({ connectionId, tabId, isActive = true, enableDrive = false, credentials }: RdpViewerProps) {
  const displayRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<Guacamole.Client | null>(null);
  const activeRef = useRef(isActive);
  const keyboardRef = useRef<Guacamole.Keyboard | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'unstable' | 'error'>('connecting');
  const [error, setError] = useState('');
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  const [dlpPolicy, setDlpPolicy] = useState<ResolvedDlpPolicy | null>(null);
  const dlpPolicyRef = useRef<ResolvedDlpPolicy | null>(null);
  useEffect(() => { dlpPolicyRef.current = dlpPolicy; }, [dlpPolicy]);

  // Track whether we ever reached CONNECTED state (for reconnect eligibility)
  const wasConnectedRef = useRef(false);
  // Track permanent error flag to prevent reconnection after admin termination etc.
  const permanentErrorRef = useRef(false);
  // Track the last guacamole error message for classification at state 5
  const lastGuacErrorRef = useRef('');
  // Cleanup function returned by the inner connect setup
  const innerCleanupRef = useRef<(() => void) | null>(null);
  // Generation counter — each connectSession invocation gets a unique ID so stale
  // invocations (e.g. from React Strict Mode double-mount) bail after async gaps.
  const connectionGenRef = useRef(0);
  // Heartbeat interval ref (accessible for cleanup during reconnect)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // ResizeObserver ref
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  // Timestamp when state 3 (CONNECTED) was reached — used to gate reconnection.
  // Only connections stable for ≥ STABLE_THRESHOLD_MS qualify for auto-reconnect.
  const connectedAtRef = useRef(0);

  const credentialsRef = useRef(credentials);
  useEffect(() => { credentialsRef.current = credentials; }, [credentials]);

  // Minimum time (ms) a connection must be in state 3 (CONNECTED) before it is
  // considered stable.  Only stable connections qualify for auto-reconnect on
  // disconnect — brief connect/disconnect cycles during initial setup will show
  // an error instead of spawning a reconnection loop.
  const STABLE_THRESHOLD_MS = 5_000;

  // Reconnect connect function — creates a new Guacamole session
  const connectSession = useCallback(async () => {
    if (!displayRef.current) return;

    // Bump generation so any in-flight stale invocation bails after its next await
    const gen = ++connectionGenRef.current;

    // Clean up previous session
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
      resizeObserverRef.current = null;
    }
    if (clientRef.current) {
      clientRef.current.onclipboard = null;
      clientRef.current.onstatechange = null;
      clientRef.current.onerror = null;
      clientRef.current.disconnect();
      clientRef.current = null;
    }
    innerCleanupRef.current?.();
    innerCleanupRef.current = null;
    // End old session on server
    if (sessionIdRef.current) {
      api.post(`/sessions/rdp/${sessionIdRef.current}/end`).catch(() => {});
      sessionIdRef.current = null;
    }
    // Clear old display elements but keep the container
    if (displayRef.current) {
      displayRef.current.innerHTML = '';
    }

    const creds = credentialsRef.current;

    // Get RDP token from server
    const res = await api.post('/sessions/rdp', {
      connectionId,
      ...(creds?.credentialMode === 'domain'
        ? { credentialMode: 'domain' }
        : creds && {
            username: creds.username,
            password: creds.password,
            ...(creds.domain ? { domain: creds.domain } : {}),
          }
      ),
    });
    const { token, sessionId, dlpPolicy: resDlp } = res.data;

    // Stale check — a newer connectSession has been launched (e.g. Strict Mode
    // double-mount or rapid reconnect).  End the session we just created so it
    // doesn't leave an orphaned recording on the server.
    if (connectionGenRef.current !== gen) {
      if (sessionId) api.post(`/sessions/rdp/${sessionId}/end`).catch(() => {});
      return;
    }

    sessionIdRef.current = sessionId ?? null;
    if (resDlp) { setDlpPolicy(resDlp); dlpPolicyRef.current = resDlp; }

    // Determine WebSocket URL for guacamole-lite (proxied through Vite/nginx)
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/guacamole/?token=${encodeURIComponent(token)}`;

    const tunnel = new Guacamole.WebSocketTunnel(wsUrl);
    const client = new Guacamole.Client(tunnel);
    clientRef.current = client;

    // Get display element
    const display = client.getDisplay().getElement();
    displayRef.current?.appendChild(display);

    // Resize logic — only active after CONNECTED
    let connected = false;

    const handleResize = () => {
      if (!connected || !displayRef.current) return;
      const width = displayRef.current.clientWidth;
      const height = displayRef.current.clientHeight;
      if (width > 0 && height > 0) {
        client.sendSize(width, height);
        const guacDisplay = client.getDisplay();
        const scale = Math.min(
          width / guacDisplay.getWidth(),
          height / guacDisplay.getHeight()
        );
        if (isFinite(scale) && scale > 0) {
          guacDisplay.scale(scale);
        }
      }
    };

    // Scale display whenever Guacamole reports a new resolution
    (client.getDisplay() as unknown as { onresize: (() => void) | null }).onresize = handleResize;

    // Handle state changes
    client.onstatechange = (state: number) => {
      if (connectionGenRef.current !== gen) return; // stale connection
      switch (state) {
        case 3: // CONNECTED
          connected = true;
          wasConnectedRef.current = true;
          connectedAtRef.current = Date.now();
          lastGuacErrorRef.current = '';
          setStatus('connected');
          resetReconnect();
          // Send initial display size after a short delay to let the RDP session stabilize
          setTimeout(() => {
            handleResize();
            if (displayRef.current && !resizeObserverRef.current) {
              resizeObserverRef.current = new ResizeObserver(handleResize);
              resizeObserverRef.current.observe(displayRef.current);
            }
          }, 2000);
          // Start heartbeat to keep the persistent session alive
          if (sessionIdRef.current && !heartbeatRef.current) {
            heartbeatRef.current = setInterval(() => {
              if (sessionIdRef.current) {
                api.post(`/sessions/rdp/${sessionIdRef.current}/heartbeat`).catch((err) => {
                  if (err?.response?.status === 410) {
                    permanentErrorRef.current = true;
                    setStatus('error');
                    setError('Session expired due to inactivity. Please reconnect.');
                    client.disconnect();
                    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
                  }
                });
              }
            }, 10_000);
          }
          break;
        case 4: // UNSTABLE
          if (connected) {
            setStatus('unstable');
          }
          break;
        case 5: // DISCONNECTED
          connected = false;
          if (heartbeatRef.current) {
            clearInterval(heartbeatRef.current);
            heartbeatRef.current = null;
          }
          // Check if this is a transient or permanent disconnection
          if (permanentErrorRef.current) {
            // Already handled (admin termination, session expired, etc.)
            return;
          }
          {
            const uptime = connectedAtRef.current ? Date.now() - connectedAtRef.current : 0;
            connectedAtRef.current = 0;
            if (
              wasConnectedRef.current &&
              uptime >= STABLE_THRESHOLD_MS &&
              !isGuacPermanentError(lastGuacErrorRef.current)
            ) {
              // Stable connection lost — attempt reconnection
              triggerReconnect();
            } else {
              // Never connected, or connection was too brief (initial setup
              // churn), or permanent error — show error, don't reconnect.
              setStatus('error');
              setError(lastGuacErrorRef.current || 'Disconnected from remote desktop');
            }
          }
          break;
      }
    };

    client.onerror = (err: { message?: string }) => {
      if (connectionGenRef.current !== gen) return;
      const msg = err.message || 'RDP connection error';
      lastGuacErrorRef.current = msg;
      if (isGuacPermanentError(msg)) {
        permanentErrorRef.current = true;
        setStatus('error');
        setError(msg);
      }
      // For non-permanent errors, let onstatechange handle the transition to state 5
    };

    // Prevent native context menu on the Guacamole display (fixes Firefox)
    const preventContextMenu = (e: Event) => e.preventDefault();
    display.addEventListener('contextmenu', preventContextMenu);

    // Mouse events — only forward when this viewer is active
    const mouse = new Guacamole.Mouse(display);
    mouse.onEach(['mousedown', 'mouseup', 'mousemove'], (e) => {
      const mouseEvent = e as Guacamole.Mouse.Event;
      if (activeRef.current) {
        mouseEvent.preventDefault();
        client.sendMouseState(mouseEvent.state);
      }
    });

    // Clipboard: remote → browser
    client.onclipboard = (stream: Guacamole.InputStream, mimetype: string) => {
      if (mimetype !== 'text/plain') return;
      const reader = new Guacamole.StringReader(stream);
      let data = '';
      reader.ontext = (text: string) => { data += text; };
      reader.onend = () => {
        onRemoteClipboard(data);
        if (dlpPolicyRef.current?.disableCopy) return;
        if (data && navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(data).catch((err) => {
            console.warn('Failed to write to browser clipboard:', err);
          });
        }
      };
    };

    // Keyboard events — only forward when this viewer is active and focused
    // displayRef.current is guaranteed non-null here (guarded at the top)
    const keyboard = new Guacamole.Keyboard(displayRef.current as HTMLElement);
    keyboardRef.current = keyboard;
    keyboard.onkeydown = (keysym: number) => {
      if (!activeRef.current) return false;
      client.sendKeyEvent(1, keysym);
      return false;
    };
    keyboard.onkeyup = (keysym: number) => {
      if (!activeRef.current) return;
      client.sendKeyEvent(0, keysym);
    };

    // Connect — pass empty string so WebSocketTunnel doesn't append
    // literal "undefined" to the URL (which corrupts the base64 token)
    client.connect('');

    innerCleanupRef.current = () => {
      display.removeEventListener('contextmenu', preventContextMenu);
      keyboard.onkeydown = null;
      keyboard.onkeyup = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- credentials tracked via ref
  }, [connectionId]);

  const { reconnectState, attempt, maxRetries, triggerReconnect, cancelReconnect, resetReconnect } = useAutoReconnect(
    connectSession,
  );

  // Keep activeRef in sync with prop (used by Guacamole keyboard/mouse handlers)
  useEffect(() => { activeRef.current = isActive; }, [isActive]);

  // Clipboard: browser → remote
  // Firefox 125+ shows a native "Paste" popup every time navigator.clipboard.readText()
  // is called, so we skip automatic clipboard sync on Firefox to avoid it.
  // See: https://github.com/Ylianst/MeshCentral/issues/6571
  const isFirefox = /firefox/i.test(navigator.userAgent);
  const syncClipboardToRemote = useCallback(() => {
    if (isFirefox) return;
    if (dlpPolicyRef.current?.disablePaste) return;
    const client = clientRef.current;
    if (!client || !activeRef.current) return;
    if (!navigator.clipboard?.readText) return;
    navigator.clipboard.readText().then((text) => {
      if (!text) return;
      const stream = client.createClipboardStream('text/plain');
      const writer = new Guacamole.StringWriter(stream);
      writer.sendText(text);
      writer.sendEnd();
    }).catch((err) => {
      console.warn('Failed to read browser clipboard:', err);
    });
  }, [isFirefox]);

  // Keyboard capture, focus management, and fullscreen
  const { isFullscreen, toggleFullscreen } = useKeyboardCapture({
    focusRef: displayRef,
    fullscreenRef: containerRef,
    isActive,
    onBlur: () => keyboardRef.current?.reset(),
    onFocus: syncClipboardToRemote,
    onMouseDown: syncClipboardToRemote,
    suppressBrowserKeys: true,
  });

  // Build toolbar actions via shared hook
  const { actions: toolbarActions, onRemoteClipboard } = useGuacToolbarActions({
    protocol: 'RDP',
    clientRef,
    tabId,
    dlpPolicy,
    isFullscreen,
    toggleFullscreen,
    enableDrive,
    fileBrowserOpen,
    onToggleDrive: () => setFileBrowserOpen((prev) => !prev),
  });

  // Listen for admin-initiated session termination via the /notifications namespace.
  useEffect(() => {
    const accessToken = useAuthStore.getState().accessToken;
    if (!accessToken) return;

    const socket = io('/notifications', {
      auth: { token: accessToken },
      transports: ['websocket'],
    });

    const handler = (data: { sessionId: string }) => {
      if (data.sessionId && data.sessionId === sessionIdRef.current) {
        permanentErrorRef.current = true;
        cancelReconnect();
        setStatus('error');
        setError('Session terminated by administrator');
        clientRef.current?.disconnect();
      }
    };

    socket.on('session:terminated', handler);

    return () => {
      socket.off('session:terminated', handler);
      socket.disconnect();
    };
  }, [connectionId, cancelReconnect]);

  // Initial connection
  useEffect(() => {
    if (!displayRef.current) return;

    permanentErrorRef.current = false;
    wasConnectedRef.current = false;
    lastGuacErrorRef.current = '';
    connectedAtRef.current = 0;

    // Capture ref value for cleanup — React refs may change by the time cleanup runs
    const displayEl = displayRef.current;

    // connectSession bumps connectionGenRef synchronously on entry, so we
    // can snapshot the generation immediately after the (sync) call start.
    connectSession().catch((err: unknown) => {
      // If the generation was bumped by cleanup or a newer invocation,
      // this error is stale — the new invocation's state updates take over.
      if (connectionGenRef.current !== mountGen) return;
      setStatus('error');
      setError(extractApiError(err, err instanceof Error ? err.message : 'Failed to start RDP session'));
    });
    // connectSession increments the ref synchronously before its first await,
    // so this captures the generation for THIS mount's connection.
    const mountGen = connectionGenRef.current;

    return () => {
      // Bump generation to invalidate any in-flight connectSession from this mount
      ++connectionGenRef.current;
      cancelReconnect();
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
      innerCleanupRef.current?.();
      if (keyboardRef.current) {
        keyboardRef.current.reset();
        keyboardRef.current = null;
      }
      if (clientRef.current) {
        clientRef.current.onclipboard = null;
        clientRef.current.onstatechange = null;
        clientRef.current.onerror = null;
        clientRef.current.disconnect();
      }
      // Signal the server to close the persistent session (fire-and-forget)
      if (sessionIdRef.current) {
        api.post(`/sessions/rdp/${sessionIdRef.current}/end`).catch(() => {});
        sessionIdRef.current = null;
      }
      if (displayEl) {
        displayEl.blur();
        displayEl.innerHTML = '';
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- credentials intentionally excluded; connect once on mount
  }, [connectionId]);

  return (
    <Box ref={containerRef} sx={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {status === 'connecting' && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1,
            bgcolor: 'rgba(0,0,0,0.7)',
          }}
        >
          <CircularProgress size={24} sx={{ mr: 1 }} />
          <Typography>Connecting to remote desktop...</Typography>
        </Box>
      )}
      {status === 'error' && reconnectState === 'idle' && (
        <Alert severity="error" sx={{ m: 1 }}>
          {error}
        </Alert>
      )}
      {status === 'unstable' && reconnectState === 'idle' && (
        <ReconnectOverlay state="unstable" attempt={0} maxRetries={maxRetries} protocol="RDP" />
      )}
      {reconnectState === 'reconnecting' && (
        <ReconnectOverlay state="reconnecting" attempt={attempt} maxRetries={maxRetries} protocol="RDP" />
      )}
      {reconnectState === 'failed' && (
        <ReconnectOverlay
          state="failed"
          attempt={attempt}
          maxRetries={maxRetries}
          protocol="RDP"
          onRetry={() => {
            permanentErrorRef.current = false;
            wasConnectedRef.current = true;
            triggerReconnect();
          }}
        />
      )}
      {status === 'connected' && (
        <DockedToolbar actions={toolbarActions} containerRef={containerRef} />
      )}
      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Box
          ref={displayRef}
          tabIndex={-1}
          sx={{
            flex: 1,
            overflow: 'hidden',
            cursor: status === 'connected' ? 'none' : 'default',
            outline: 'none',
            '& > div': { width: '100% !important', height: '100% !important' },
          }}
        />
        {enableDrive && !(dlpPolicy?.disableDownload && dlpPolicy?.disableUpload) && (
          <FileBrowser
            open={fileBrowserOpen}
            onClose={() => setFileBrowserOpen(false)}
            disableDownload={dlpPolicy?.disableDownload}
            disableUpload={dlpPolicy?.disableUpload}
          />
        )}
      </Box>
    </Box>
  );
}
