import { useEffect, useRef, useState, useMemo } from 'react';
import { Box, CircularProgress, Typography, Alert } from '@mui/material';
import { FolderOpen as FolderOpenIcon } from '@mui/icons-material';
import * as Guacamole from '@glokon/guacamole-common-js';
import { io } from 'socket.io-client';
import api from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import type { CredentialOverride } from '../../store/tabsStore';
import FileBrowser from './FileBrowser';
import FloatingToolbar, { ToolbarAction } from '../shared/FloatingToolbar';

interface RdpViewerProps {
  connectionId: string;
  tabId: string;
  isActive?: boolean;
  enableDrive?: boolean;
  credentials?: CredentialOverride;
}

export default function RdpViewer({ connectionId, tabId: _tabId, isActive = true, enableDrive = false, credentials }: RdpViewerProps) {
  const displayRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<Guacamole.Client | null>(null);
  const activeRef = useRef(isActive);
  const keyboardRef = useRef<Guacamole.Keyboard | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [error, setError] = useState('');
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);

  // Build toolbar actions list — extensible for future tools
  const toolbarActions = useMemo<ToolbarAction[]>(() => {
    const actions: ToolbarAction[] = [];
    if (enableDrive) {
      actions.push({
        id: 'shared-drive',
        icon: <FolderOpenIcon fontSize="small" />,
        tooltip: 'Shared Drive',
        onClick: () => setFileBrowserOpen((prev) => !prev),
        active: fileBrowserOpen,
      });
    }
    return actions;
  }, [enableDrive, fileBrowserOpen]);

  // Keep activeRef in sync with prop; release keys and blur on tab switch
  useEffect(() => {
    activeRef.current = isActive;
    if (!isActive) {
      keyboardRef.current?.reset();
      displayRef.current?.blur();
    }
  }, [isActive]);

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
  }, [connectionId]);

  useEffect(() => {
    if (!displayRef.current) return;

    let cancelled = false;

    async function connect() {
      try {
        // Get RDP token from server
        const res = await api.post('/sessions/rdp', {
          connectionId,
          ...(credentials?.credentialMode === 'domain'
            ? { credentialMode: 'domain' }
            : credentials && {
                username: credentials.username,
                password: credentials.password,
                ...(credentials.domain ? { domain: credentials.domain } : {}),
              }
          ),
        });
        const { token, sessionId } = res.data;
        sessionIdRef.current = sessionId ?? null;

        if (cancelled) return;

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
        let resizeObserver: ResizeObserver | null = null;
        let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

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
          if (cancelled) return;
          switch (state) {
            case 3: // CONNECTED
              connected = true;
              setStatus('connected');
              // Send initial display size after a short delay to let the RDP session stabilize
              setTimeout(() => {
                handleResize();
                if (displayRef.current && !resizeObserver) {
                  resizeObserver = new ResizeObserver(handleResize);
                  resizeObserver.observe(displayRef.current);
                }
              }, 2000);
              // Start heartbeat to keep the persistent session alive
              if (sessionIdRef.current && !heartbeatInterval) {
                heartbeatInterval = setInterval(() => {
                  if (sessionIdRef.current) {
                    api.post(`/sessions/rdp/${sessionIdRef.current}/heartbeat`).catch((err) => {
                      if (err?.response?.status === 410) {
                        setStatus('error');
                        setError('Session expired due to inactivity. Please reconnect.');
                        client.disconnect();
                        if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
                      }
                    });
                  }
                }, 10_000);
              }
              break;
            case 5: // DISCONNECTED
              connected = false;
              setStatus('error');
              setError('Disconnected from remote desktop');
              break;
          }
        };

        client.onerror = (err: { message?: string }) => {
          if (cancelled) return;
          setStatus('error');
          setError(err.message || 'RDP connection error');
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
            if (data && navigator.clipboard?.writeText) {
              navigator.clipboard.writeText(data).catch((err) => {
                console.warn('Failed to write to browser clipboard:', err);
              });
            }
          };
        };

        // Keyboard events — only forward when this viewer is active and focused
        // displayRef.current is guaranteed non-null here (guarded at the top of the effect)
        const keyboard = new Guacamole.Keyboard(displayRef.current as HTMLElement);
        keyboardRef.current = keyboard;
        keyboard.onkeydown = (keysym: number) => {
          if (!activeRef.current) return false;
          client.sendKeyEvent(1, keysym);
          return true;
        };
        keyboard.onkeyup = (keysym: number) => {
          if (!activeRef.current) return;
          client.sendKeyEvent(0, keysym);
        };

        // Connect — pass empty string so WebSocketTunnel doesn't append
        // literal "undefined" to the URL (which corrupts the base64 token)
        client.connect('');

        return () => {
          resizeObserver?.disconnect();
          display.removeEventListener('contextmenu', preventContextMenu);
          keyboard.onkeydown = null;
          keyboard.onkeyup = null;
          if (heartbeatInterval) clearInterval(heartbeatInterval);
        };
      } catch (err: unknown) {
        if (cancelled) return;
        setStatus('error');
        const msg =
          (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
          (err instanceof Error ? err.message : 'Failed to start RDP session');
        setError(msg);
      }
    }

    connect();

    // Capture ref value for cleanup — React refs may change by the time cleanup runs
    const displayEl = displayRef.current;

    return () => {
      cancelled = true;
      if (keyboardRef.current) {
        keyboardRef.current.reset();
        keyboardRef.current = null;
      }
      if (clientRef.current) {
        clientRef.current.onclipboard = null;
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

  // Focus management: capture keyboard only when mouse hovers over the display
  useEffect(() => {
    const container = displayRef.current;
    if (!container) return;

    const handleMouseEnter = () => {
      if (activeRef.current) container.focus();
    };
    const handleMouseLeave = () => {
      keyboardRef.current?.reset();
      container.blur();
    };
    const handleBlur = () => {
      keyboardRef.current?.reset();
    };

    // Clipboard: browser → remote
    // Firefox 125+ shows a native "Paste" popup every time navigator.clipboard.readText()
    // is called, so we skip automatic clipboard sync on Firefox to avoid it.
    // See: https://github.com/Ylianst/MeshCentral/issues/6571
    const isFirefox = /firefox/i.test(navigator.userAgent);
    const syncClipboardToRemote = () => {
      if (isFirefox) return;
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
    };
    const handleFocus = () => { syncClipboardToRemote(); };
    const handleMouseDown = () => { syncClipboardToRemote(); };

    container.addEventListener('mouseenter', handleMouseEnter);
    container.addEventListener('mouseleave', handleMouseLeave);
    container.addEventListener('blur', handleBlur);
    container.addEventListener('focus', handleFocus);
    container.addEventListener('mousedown', handleMouseDown);

    return () => {
      container.removeEventListener('mouseenter', handleMouseEnter);
      container.removeEventListener('mouseleave', handleMouseLeave);
      container.removeEventListener('blur', handleBlur);
      container.removeEventListener('focus', handleFocus);
      container.removeEventListener('mousedown', handleMouseDown);
    };
  }, []);

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
      {status === 'error' && (
        <Alert severity="error" sx={{ m: 1 }}>
          {error}
        </Alert>
      )}
      {toolbarActions.length > 0 && status === 'connected' && (
        <FloatingToolbar actions={toolbarActions} containerRef={containerRef} />
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
        {enableDrive && (
          <FileBrowser open={fileBrowserOpen} onClose={() => setFileBrowserOpen(false)} />
        )}
      </Box>
    </Box>
  );
}
