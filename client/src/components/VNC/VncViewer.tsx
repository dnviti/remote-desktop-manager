import { useEffect, useRef, useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import * as Guacamole from '@glokon/guacamole-common-js';
import api from '../../api/client';
import type { CredentialOverride } from '../../store/tabsStore';
import type { ResolvedDlpPolicy } from '../../api/connections.api';
import DockedToolbar from '../shared/DockedToolbar';
import ReconnectOverlay from '../shared/ReconnectOverlay';
import { extractApiError } from '../../utils/apiError';
import { useAutoReconnect } from '../../hooks/useAutoReconnect';
import { useKeyboardCapture } from '../../hooks/useKeyboardCapture';
import { useGuacToolbarActions } from '../../hooks/useGuacToolbarActions';
import { isGuacPermanentError } from '../../utils/reconnectClassifier';

interface VncViewerProps {
  connectionId: string;
  tabId: string;
  isActive?: boolean;
  credentials?: CredentialOverride;
}

export default function VncViewer({ connectionId, tabId, isActive = true, credentials }: VncViewerProps) {
  const displayRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<Guacamole.Client | null>(null);
  const activeRef = useRef(isActive);
  const keyboardRef = useRef<Guacamole.Keyboard | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'unstable' | 'error'>('connecting');
  const [error, setError] = useState('');
  const [dlpPolicy, setDlpPolicy] = useState<ResolvedDlpPolicy | null>(null);
  const dlpPolicyRef = useRef<ResolvedDlpPolicy | null>(null);
  useEffect(() => { dlpPolicyRef.current = dlpPolicy; }, [dlpPolicy]);

  const wasConnectedRef = useRef(false);
  const permanentErrorRef = useRef(false);
  const lastGuacErrorRef = useRef('');
  const innerCleanupRef = useRef<(() => void) | null>(null);
  const connectionGenRef = useRef(0);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const connectedAtRef = useRef(0);

  const credentialsRef = useRef(credentials);
  useEffect(() => { credentialsRef.current = credentials; }, [credentials]);

  const STABLE_THRESHOLD_MS = 5_000;

  const connectSession = useCallback(async () => {
    if (!displayRef.current) return;

    const gen = ++connectionGenRef.current;

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
    if (sessionIdRef.current) {
      api.post(`/sessions/vnc/${sessionIdRef.current}/end`).catch(() => {});
      sessionIdRef.current = null;
    }
    if (displayRef.current) {
      displayRef.current.innerHTML = '';
    }

    const creds = credentialsRef.current;

    const res = await api.post('/sessions/vnc', {
      connectionId,
      ...(creds && {
        password: creds.password,
      }),
    });
    const { token, sessionId, dlpPolicy: resDlp } = res.data;

    if (connectionGenRef.current !== gen) {
      if (sessionId) api.post(`/sessions/vnc/${sessionId}/end`).catch(() => {});
      return;
    }

    sessionIdRef.current = sessionId ?? null;
    if (resDlp) { setDlpPolicy(resDlp); dlpPolicyRef.current = resDlp; }

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/guacamole/`;

    const tunnel = new Guacamole.WebSocketTunnel(wsUrl);
    const client = new Guacamole.Client(tunnel);
    clientRef.current = client;

    const display = client.getDisplay().getElement();
    displayRef.current?.appendChild(display);

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

    (client.getDisplay() as unknown as { onresize: (() => void) | null }).onresize = handleResize;

    client.onstatechange = (state: number) => {
      if (connectionGenRef.current !== gen) return;
      switch (state) {
        case 3:
          connected = true;
          wasConnectedRef.current = true;
          connectedAtRef.current = Date.now();
          lastGuacErrorRef.current = '';
          setStatus('connected');
          resetReconnect();
          setTimeout(() => {
            handleResize();
            if (displayRef.current && !resizeObserverRef.current) {
              resizeObserverRef.current = new ResizeObserver(handleResize);
              resizeObserverRef.current.observe(displayRef.current);
            }
          }, 2000);
          if (sessionIdRef.current && !heartbeatRef.current) {
            heartbeatRef.current = setInterval(() => {
              if (sessionIdRef.current) {
                api.post(`/sessions/vnc/${sessionIdRef.current}/heartbeat`).catch((err) => {
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
        case 4:
          if (connected) {
            setStatus('unstable');
          }
          break;
        case 5:
          connected = false;
          if (heartbeatRef.current) {
            clearInterval(heartbeatRef.current);
            heartbeatRef.current = null;
          }
          if (permanentErrorRef.current) return;
          {
            const uptime = connectedAtRef.current ? Date.now() - connectedAtRef.current : 0;
            connectedAtRef.current = 0;
            if (
              wasConnectedRef.current &&
              uptime >= STABLE_THRESHOLD_MS &&
              !isGuacPermanentError(lastGuacErrorRef.current)
            ) {
              triggerReconnect();
            } else {
              setStatus('error');
              setError(lastGuacErrorRef.current || 'Disconnected from VNC session');
            }
          }
          break;
      }
    };

    client.onerror = (err: { message?: string }) => {
      if (connectionGenRef.current !== gen) return;
      const msg = err.message || 'VNC connection error';
      lastGuacErrorRef.current = msg;
      if (isGuacPermanentError(msg)) {
        permanentErrorRef.current = true;
        setStatus('error');
        setError(msg);
      }
    };

    const preventContextMenu = (e: Event) => e.preventDefault();
    const preventMiddleClickDefault = (event: MouseEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
    };
    display.addEventListener('contextmenu', preventContextMenu);
    display.addEventListener('auxclick', preventMiddleClickDefault);
    display.addEventListener('mousedown', preventMiddleClickDefault);
    display.addEventListener('mouseup', preventMiddleClickDefault);

    const mouse = new Guacamole.Mouse(display);
    mouse.onEach(['mousedown', 'mouseup', 'mousemove'], (e) => {
      const mouseEvent = e as Guacamole.Mouse.Event;
      if (activeRef.current) {
        mouseEvent.preventDefault();
        client.sendMouseState(mouseEvent.state);
      }
    });

    client.onclipboard = (stream: Guacamole.InputStream, mimetype: string) => {
      if (mimetype !== 'text/plain') return;
      const reader = new Guacamole.StringReader(stream);
      let data = '';
      reader.ontext = (text: string) => { data += text; };
      reader.onend = () => {
        onRemoteClipboardRef.current(data);
        if (dlpPolicyRef.current?.disableCopy) return;
        if (data && navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(data).catch((err) => {
            console.warn('Failed to write to browser clipboard:', err);
          });
        }
      };
    };

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

    client.connect(`token=${encodeURIComponent(token)}`);

    innerCleanupRef.current = () => {
      display.removeEventListener('contextmenu', preventContextMenu);
      display.removeEventListener('auxclick', preventMiddleClickDefault);
      display.removeEventListener('mousedown', preventMiddleClickDefault);
      display.removeEventListener('mouseup', preventMiddleClickDefault);
      keyboard.onkeydown = null;
      keyboard.onkeyup = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- credentials tracked via ref
  }, [connectionId]);

  const { reconnectState, attempt, maxRetries, triggerReconnect, cancelReconnect, resetReconnect } = useAutoReconnect(
    connectSession,
  );

  useEffect(() => { activeRef.current = isActive; }, [isActive]);

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

  const { isFullscreen, toggleFullscreen } = useKeyboardCapture({
    focusRef: displayRef,
    fullscreenRef: containerRef,
    isActive,
    onBlur: () => keyboardRef.current?.reset(),
    onFocus: syncClipboardToRemote,
    onMouseDown: syncClipboardToRemote,
    suppressBrowserKeys: true,
  });

  const onRemoteClipboardRef = useRef<(text: string) => void>(() => {});

  const { actions: toolbarActions, onRemoteClipboard } = useGuacToolbarActions({
    protocol: 'VNC',
    clientRef,
    tabId,
    dlpPolicy,
    isFullscreen,
    toggleFullscreen,
  });
  useEffect(() => { onRemoteClipboardRef.current = onRemoteClipboard; }, [onRemoteClipboard]);

  useEffect(() => {
    if (!displayRef.current) return;

    permanentErrorRef.current = false;
    wasConnectedRef.current = false;
    lastGuacErrorRef.current = '';
    connectedAtRef.current = 0;

    const displayEl = displayRef.current;

    connectSession().catch((err: unknown) => {
      if (connectionGenRef.current !== mountGen) return;
      setStatus('error');
      setError(extractApiError(err, err instanceof Error ? err.message : 'Failed to start VNC session'));
    });
    const mountGen = connectionGenRef.current;

    return () => {
      const genRef = connectionGenRef;
      ++genRef.current;
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
      if (sessionIdRef.current) {
        api.post(`/sessions/vnc/${sessionIdRef.current}/end`).catch(() => {});
        sessionIdRef.current = null;
      }
      if (displayEl) {
        displayEl.blur();
        displayEl.innerHTML = '';
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- credentials excluded; connectionGenRef write in cleanup is intentional
  }, [connectionId]);

  return (
    <div ref={containerRef} className="flex flex-1 flex-row relative overflow-hidden">
      {status === 'connected' && (
        <DockedToolbar actions={toolbarActions} />
      )}
      <div className="flex flex-1 flex-col min-w-0 relative">
      {status === 'connecting' && (
        <div className="absolute inset-0 flex items-center justify-center z-10 bg-black/70">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          <span>Connecting to VNC session...</span>
        </div>
      )}
      {status === 'error' && reconnectState === 'idle' && (
        <div className="m-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}
      {status === 'unstable' && reconnectState === 'idle' && (
        <ReconnectOverlay state="unstable" attempt={0} maxRetries={maxRetries} protocol="VNC" />
      )}
      {reconnectState === 'reconnecting' && (
        <ReconnectOverlay state="reconnecting" attempt={attempt} maxRetries={maxRetries} protocol="VNC" />
      )}
      {reconnectState === 'failed' && (
        <ReconnectOverlay
          state="failed"
          attempt={attempt}
          maxRetries={maxRetries}
          protocol="VNC"
          onRetry={() => {
            permanentErrorRef.current = false;
            wasConnectedRef.current = true;
            triggerReconnect();
          }}
        />
      )}
      <div
        ref={displayRef}
        tabIndex={-1}
        className={`flex-1 overflow-hidden outline-none ${status === 'connected' ? 'cursor-none' : 'cursor-default'} [&>div]:!w-full [&>div]:!h-full`}
      />
      </div>{/* end inner content column */}
    </div>
  );
}
