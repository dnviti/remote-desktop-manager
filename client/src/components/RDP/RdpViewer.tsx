import { useEffect, useRef, useState } from 'react';
import { Box, CircularProgress, Typography, Alert } from '@mui/material';
import Guacamole from 'guacamole-common-js';
import api from '../../api/client';

interface RdpViewerProps {
  connectionId: string;
  tabId: string;
  isActive?: boolean;
}

export default function RdpViewer({ connectionId, tabId, isActive = true }: RdpViewerProps) {
  const displayRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<Guacamole.Client | null>(null);
  const activeRef = useRef(isActive);
  const keyboardRef = useRef<Guacamole.Keyboard | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [error, setError] = useState('');

  // Keep activeRef in sync with prop; release keys and blur on tab switch
  useEffect(() => {
    activeRef.current = isActive;
    if (!isActive) {
      keyboardRef.current?.reset();
      displayRef.current?.blur();
    }
  }, [isActive]);

  useEffect(() => {
    if (!displayRef.current) return;

    let cancelled = false;

    async function connect() {
      try {
        // Get RDP token from server
        const res = await api.post('/sessions/rdp', { connectionId });
        const { token } = res.data;

        if (cancelled) return;

        // Determine WebSocket URL for guacamole-lite (proxied through Vite/nginx)
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${window.location.host}/guacamole/?token=${encodeURIComponent(token)}`;

        const tunnel = new Guacamole.WebSocketTunnel(wsUrl);
        const client = new Guacamole.Client(tunnel);
        clientRef.current = client;

        // Get display element
        const display = client.getDisplay().getElement();
        displayRef.current!.appendChild(display);

        // Resize logic — only active after CONNECTED
        let connected = false;
        let resizeObserver: ResizeObserver | null = null;

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
        (client.getDisplay() as any).onresize = handleResize;

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

        // Mouse events — only forward when this viewer is active
        const mouse = new Guacamole.Mouse(display);
        mouse.onEach(['mousedown', 'mouseup', 'mousemove'], (e: Guacamole.Mouse.Event) => {
          if (activeRef.current) client.sendMouseState(e.state);
        });

        // Keyboard events — only forward when this viewer is active and focused
        const keyboard = new Guacamole.Keyboard(displayRef.current!);
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

        // Connect
        client.connect();

        return () => {
          resizeObserver?.disconnect();
          keyboard.onkeydown = null;
          keyboard.onkeyup = null;
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

    return () => {
      cancelled = true;
      if (keyboardRef.current) {
        keyboardRef.current.reset();
        keyboardRef.current = null;
      }
      if (clientRef.current) {
        clientRef.current.disconnect();
      }
      if (displayRef.current) {
        displayRef.current.blur();
        displayRef.current.innerHTML = '';
      }
    };
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

    container.addEventListener('mouseenter', handleMouseEnter);
    container.addEventListener('mouseleave', handleMouseLeave);
    container.addEventListener('blur', handleBlur);

    return () => {
      container.removeEventListener('mouseenter', handleMouseEnter);
      container.removeEventListener('mouseleave', handleMouseLeave);
      container.removeEventListener('blur', handleBlur);
    };
  }, []);

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
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
    </Box>
  );
}
