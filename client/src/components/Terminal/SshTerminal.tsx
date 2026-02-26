import { useEffect, useRef, useState } from 'react';
import { Box, CircularProgress, Typography, Alert } from '@mui/material';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../../store/authStore';
import '@xterm/xterm/css/xterm.css';

interface SshTerminalProps {
  connectionId: string;
  tabId: string;
}

export default function SshTerminal({ connectionId, tabId }: SshTerminalProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [error, setError] = useState('');
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (!termRef.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1a1a2e',
        foreground: '#e0e0e0',
        cursor: '#2196f3',
      },
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(termRef.current);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Connect to SSH Socket.io namespace
    const socket = io('/ssh', {
      auth: { token: accessToken },
      transports: ['websocket'],
    });

    socketRef.current = socket;

    // Clipboard: Ctrl+Shift+C to copy, Ctrl+Shift+V to paste
    terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.type !== 'keydown') return true;

      if (event.ctrlKey && event.shiftKey && event.key === 'C') {
        const selection = terminal.getSelection();
        if (selection && navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(selection).catch((err) => {
            console.warn('Failed to copy to clipboard:', err);
          });
        }
        return false;
      }

      if (event.ctrlKey && event.shiftKey && event.key === 'V') {
        if (navigator.clipboard?.readText) {
          navigator.clipboard.readText().then((text) => {
            if (text && socket.connected) {
              socket.emit('data', text);
            }
          }).catch((err) => {
            console.warn('Failed to read clipboard:', err);
          });
        }
        return false;
      }

      return true;
    });

    socket.on('connect', () => {
      socket.emit('session:start', { connectionId });
    });

    socket.on('session:ready', () => {
      setStatus('connected');
      // Send initial size
      socket.emit('resize', { cols: terminal.cols, rows: terminal.rows });
    });

    socket.on('data', (data: string) => {
      terminal.write(data);
    });

    socket.on('session:error', (data: { message: string }) => {
      setStatus('error');
      setError(data.message);
      terminal.write(`\r\n\x1b[31mError: ${data.message}\x1b[0m\r\n`);
    });

    socket.on('session:closed', () => {
      terminal.write('\r\n\x1b[33mConnection closed.\x1b[0m\r\n');
    });

    socket.on('connect_error', (err) => {
      setStatus('error');
      setError(err.message);
    });

    // Send terminal input to server
    terminal.onData((data) => {
      socket.emit('data', data);
    });

    // Handle resize
    const handleResize = () => {
      fitAddon.fit();
      socket.emit('resize', { cols: terminal.cols, rows: terminal.rows });
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(termRef.current);

    return () => {
      resizeObserver.disconnect();
      socket.disconnect();
      terminal.dispose();
    };
  }, [connectionId, accessToken]);

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
          <Typography>Connecting...</Typography>
        </Box>
      )}
      {status === 'error' && (
        <Alert severity="error" sx={{ m: 1 }}>
          {error}
        </Alert>
      )}
      <Box
        ref={termRef}
        sx={{ flex: 1, overflow: 'hidden', '& .xterm': { height: '100%', padding: '4px' } }}
      />
    </Box>
  );
}
