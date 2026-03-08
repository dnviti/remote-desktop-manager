import { useEffect, useRef, useState, useMemo } from 'react';
import { Box, CircularProgress, Typography, Alert } from '@mui/material';
import { FolderOpen as FolderOpenIcon } from '@mui/icons-material';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../../store/authStore';
import { useUiPreferencesStore } from '../../store/uiPreferencesStore';
import { useTerminalSettingsStore } from '../../store/terminalSettingsStore';
import type { CredentialOverride } from '../../store/tabsStore';
import type { SshTerminalConfig } from '../../constants/terminalThemes';
import { mergeTerminalConfig, toXtermOptions, resolveThemeForMode, THEME_PRESETS } from '../../constants/terminalThemes';
import { useThemeStore } from '../../store/themeStore';
import FloatingToolbar, { ToolbarAction } from '../shared/FloatingToolbar';
import SftpBrowser from '../SSH/SftpBrowser';
import '@xterm/xterm/css/xterm.css';

interface SshTerminalProps {
  connectionId: string;
  tabId: string;
  credentials?: CredentialOverride;
  sshTerminalConfig?: Partial<SshTerminalConfig> | null;
}

export default function SshTerminal({ connectionId, tabId: _tabId, credentials, sshTerminalConfig }: SshTerminalProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [error, setError] = useState('');
  const accessToken = useAuthStore((s) => s.accessToken);
  const userDefaults = useTerminalSettingsStore((s) => s.userDefaults);
  const webUiMode = useThemeStore((s) => s.mode);

  // Compute xterm options from merged config (applied at mount only)
  const xtermOptions = useMemo(
    () => toXtermOptions(mergeTerminalConfig(userDefaults, sshTerminalConfig), webUiMode),
    [userDefaults, sshTerminalConfig, webUiMode],
  );
  const xtermOptionsRef = useRef(xtermOptions);
  useEffect(() => {
    xtermOptionsRef.current = xtermOptions;
  }, [xtermOptions]);

  // Dynamically update terminal theme when WebUI mode changes
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    const merged = mergeTerminalConfig(userDefaults, sshTerminalConfig);
    const effectiveTheme = resolveThemeForMode(merged, webUiMode);
    const colors = effectiveTheme === 'custom'
      ? merged.customColors
      : THEME_PRESETS[effectiveTheme] ?? THEME_PRESETS['default-dark'];

    terminal.options.theme = {
      background: colors.background,
      foreground: colors.foreground,
      cursor: colors.cursor,
      selectionBackground: colors.selectionBackground,
      black: colors.black,
      red: colors.red,
      green: colors.green,
      yellow: colors.yellow,
      blue: colors.blue,
      magenta: colors.magenta,
      cyan: colors.cyan,
      white: colors.white,
      brightBlack: colors.brightBlack,
      brightRed: colors.brightRed,
      brightGreen: colors.brightGreen,
      brightYellow: colors.brightYellow,
      brightBlue: colors.brightBlue,
      brightMagenta: colors.brightMagenta,
      brightCyan: colors.brightCyan,
      brightWhite: colors.brightWhite,
    };
  }, [webUiMode, userDefaults, sshTerminalConfig]);

  // Resolve bell style for onBell handler
  const bellStyle = mergeTerminalConfig(userDefaults, sshTerminalConfig).bellStyle;
  const bellStyleRef = useRef(bellStyle);
  useEffect(() => {
    bellStyleRef.current = bellStyle;
  }, [bellStyle]);

  const sftpOpen = useUiPreferencesStore((s) => s.sshSftpBrowserOpen);
  const togglePref = useUiPreferencesStore((s) => s.toggle);

  const toolbarActions = useMemo<ToolbarAction[]>(() => [
    {
      id: 'sftp-browser',
      icon: <FolderOpenIcon fontSize="small" />,
      tooltip: 'SFTP File Browser',
      onClick: () => togglePref('sshSftpBrowserOpen'),
      active: sftpOpen,
    },
  ], [sftpOpen, togglePref]);

  // Refit terminal when SFTP drawer opens/closes
  useEffect(() => {
    const timer = setTimeout(() => {
      fitAddonRef.current?.fit();
      if (socketRef.current?.connected && terminalRef.current) {
        socketRef.current.emit('resize', {
          cols: terminalRef.current.cols,
          rows: terminalRef.current.rows,
        });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [sftpOpen]);

  useEffect(() => {
    if (!termRef.current) return;

    const terminal = new Terminal(xtermOptionsRef.current);

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

    // Bell handler
    terminal.onBell(() => {
      if (bellStyleRef.current === 'sound') {
        try { new Audio('data:audio/wav;base64,UklGRl9vT19teleVhZUAAQABADS...').play().catch(() => {}); } catch { /* ignore */ }
      } else if (bellStyleRef.current === 'visual') {
        const el = termRef.current;
        if (el) {
          el.style.outline = '2px solid #ff9800';
          setTimeout(() => { el.style.outline = ''; }, 150);
        }
      }
    });

    socket.on('connect', () => {
      socket.emit('session:start', {
        connectionId,
        ...(credentials?.credentialMode === 'domain'
          ? { credentialMode: 'domain' }
          : credentials && { username: credentials.username, password: credentials.password }
        ),
      });
    });

    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

    socket.on('session:ready', () => {
      setStatus('connected');
      // Send initial size
      socket.emit('resize', { cols: terminal.cols, rows: terminal.rows });

      // Start heartbeat interval
      heartbeatInterval = setInterval(() => {
        if (socket.connected) {
          socket.emit('session:heartbeat');
        }
      }, 30_000);
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

    socket.on('session:timeout', () => {
      terminal.write('\r\n\x1b[31mSession expired due to inactivity.\x1b[0m\r\n');
      setStatus('error');
      setError('Session expired due to inactivity');
    });

    socket.on('session:terminated', () => {
      terminal.write('\r\n\x1b[31mSession terminated by administrator.\x1b[0m\r\n');
      setStatus('error');
      setError('Session terminated by administrator');
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
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      resizeObserver.disconnect();
      socket.disconnect();
      terminal.dispose();
    };
  }, [connectionId, accessToken]);

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
          <Typography>Connecting...</Typography>
        </Box>
      )}
      {status === 'error' && (
        <Alert severity="error" sx={{ m: 1 }}>
          {error}
        </Alert>
      )}
      {status === 'connected' && (
        <FloatingToolbar actions={toolbarActions} containerRef={containerRef} />
      )}
      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Box
          ref={termRef}
          sx={{ flex: 1, overflow: 'hidden', '& .xterm': { height: '100%', padding: '4px' } }}
        />
        {/* eslint-disable react-hooks/refs -- socket ref is stable after mount */}
        <SftpBrowser
          open={sftpOpen}
          onClose={() => togglePref('sshSftpBrowserOpen')}
          socket={socketRef.current}
        />
        {/* eslint-enable react-hooks/refs */}
      </Box>
    </Box>
  );
}
