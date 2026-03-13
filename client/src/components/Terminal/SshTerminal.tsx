import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { Box, CircularProgress, Typography, Alert } from '@mui/material';
import {
  FolderOpen as FolderOpenIcon,
  Fullscreen as FullscreenIcon,
  FullscreenExit as FullscreenExitIcon,
} from '@mui/icons-material';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../../store/authStore';
import { useTabsStore } from '../../store/tabsStore';
import { useUiPreferencesStore } from '../../store/uiPreferencesStore';
import { useTerminalSettingsStore } from '../../store/terminalSettingsStore';
import type { CredentialOverride } from '../../store/tabsStore';
import type { SshTerminalConfig } from '../../constants/terminalThemes';
import { mergeTerminalConfig, toXtermOptions, resolveThemeForMode, THEME_PRESETS } from '../../constants/terminalThemes';
import { useThemeStore } from '../../store/themeStore';
import DockedToolbar, { ToolbarAction } from '../shared/DockedToolbar';
import SessionContextMenu from '../shared/SessionContextMenu';
import ReconnectOverlay from '../shared/ReconnectOverlay';
import SftpBrowser from '../SSH/SftpBrowser';
import { useAutoReconnect } from '../../hooks/useAutoReconnect';
import { useKeyboardCapture } from '../../hooks/useKeyboardCapture';
import { isSshPermanentError, isTransientDisconnect } from '../../utils/reconnectClassifier';
import type { ResolvedDlpPolicy } from '../../api/connections.api';
import '@xterm/xterm/css/xterm.css';

interface SshTerminalProps {
  connectionId: string;
  tabId: string;
  isActive?: boolean;
  credentials?: CredentialOverride;
  sshTerminalConfig?: Partial<SshTerminalConfig> | null;
}

export default function SshTerminal({ connectionId, tabId, isActive = true, credentials, sshTerminalConfig }: SshTerminalProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [error, setError] = useState('');
  const [dlpPolicy, setDlpPolicy] = useState<ResolvedDlpPolicy | null>(null);
  const dlpPolicyRef = useRef<ResolvedDlpPolicy | null>(null);
  useEffect(() => { dlpPolicyRef.current = dlpPolicy; }, [dlpPolicy]);
  const [contextMenu, setContextMenu] = useState<{ top: number; left: number } | null>(null);
  const accessToken = useAuthStore((s) => s.accessToken);
  const userDefaults = useTerminalSettingsStore((s) => s.userDefaults);
  const webUiMode = useThemeStore((s) => s.mode);

  // Reconnection state refs
  const wasConnectedRef = useRef(false);
  const permanentErrorRef = useRef(false);
  const cancelledRef = useRef(false);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const credentialsRef = useRef(credentials);
  useEffect(() => { credentialsRef.current = credentials; }, [credentials]);

  const accessTokenRef = useRef(accessToken);
  useEffect(() => { accessTokenRef.current = accessToken; }, [accessToken]);

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

  const sftpHiddenByDlp = dlpPolicy?.disableDownload && dlpPolicy?.disableUpload;

  // Keyboard capture and fullscreen
  const { isFullscreen, toggleFullscreen } = useKeyboardCapture({
    focusRef: termRef,
    fullscreenRef: containerRef,
    isActive,
    onFullscreenChange: () => {
      setTimeout(() => {
        fitAddonRef.current?.fit();
        if (socketRef.current?.connected && terminalRef.current) {
          socketRef.current.emit('resize', {
            cols: terminalRef.current.cols,
            rows: terminalRef.current.rows,
          });
        }
      }, 100);
    },
    suppressBrowserKeys: false,
  });

  const toolbarActions = useMemo<ToolbarAction[]>(() => {
    const actions: ToolbarAction[] = [];
    if (!sftpHiddenByDlp) {
      actions.push({
        id: 'sftp-browser',
        icon: <FolderOpenIcon fontSize="small" />,
        tooltip: 'SFTP File Browser',
        onClick: () => togglePref('sshSftpBrowserOpen'),
        active: sftpOpen,
      });
    }
    actions.push({
      id: 'fullscreen',
      icon: isFullscreen ? <FullscreenExitIcon fontSize="small" /> : <FullscreenIcon fontSize="small" />,
      tooltip: isFullscreen ? 'Exit Fullscreen' : 'Fullscreen',
      onClick: toggleFullscreen,
      active: isFullscreen,
    });
    return actions;
  }, [sftpOpen, togglePref, sftpHiddenByDlp, isFullscreen, toggleFullscreen]);

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

  // Connect to SSH session — creates a new socket and emits session:start
  const connectSession = useCallback(async () => {
    // Clean up previous socket
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    const terminal = terminalRef.current;
    if (!terminal) return;

    const token = accessTokenRef.current;
    const creds = credentialsRef.current;

    const socket = io('/ssh', {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
    });
    socketRef.current = socket;

    return new Promise<void>((resolve, reject) => {
      socket.on('connect', () => {
        socket.emit('session:start', {
          connectionId,
          ...(creds?.credentialMode === 'domain'
            ? { credentialMode: 'domain' }
            : creds && { username: creds.username, password: creds.password }
          ),
        });
      });

      socket.on('session:ready', (data?: { dlpPolicy?: ResolvedDlpPolicy }) => {
        if (data?.dlpPolicy) { setDlpPolicy(data.dlpPolicy); dlpPolicyRef.current = data.dlpPolicy; }
        wasConnectedRef.current = true;
        setStatus('connected');
        resetReconnect();
        // Send initial size
        socket.emit('resize', { cols: terminal.cols, rows: terminal.rows });

        // Start heartbeat interval
        heartbeatIntervalRef.current = setInterval(() => {
          if (socket.connected) {
            socket.emit('session:heartbeat');
          }
        }, 30_000);

        if (wasConnectedRef.current) {
          terminal.write('\r\n\x1b[32m[Reconnected]\x1b[0m\r\n');
        }

        resolve();
      });

      socket.on('data', (data: string) => {
        terminal.write(data);
      });

      socket.on('session:error', (data: { message: string }) => {
        if (isSshPermanentError('session:error', data)) {
          permanentErrorRef.current = true;
          setStatus('error');
          setError(data.message);
          terminal.write(`\r\n\x1b[31mError: ${data.message}\x1b[0m\r\n`);
          reject(new Error(data.message));
        }
      });

      socket.on('session:closed', () => {
        terminal.write('\r\n\x1b[33mConnection closed.\x1b[0m\r\n');
      });

      socket.on('session:timeout', () => {
        permanentErrorRef.current = true;
        terminal.write('\r\n\x1b[31mSession expired due to inactivity.\x1b[0m\r\n');
        setStatus('error');
        setError('Session expired due to inactivity');
      });

      socket.on('session:terminated', () => {
        permanentErrorRef.current = true;
        cancelReconnect();
        terminal.write('\r\n\x1b[31mSession terminated by administrator.\x1b[0m\r\n');
        setStatus('error');
        setError('Session terminated by administrator');
      });

      socket.on('connect_error', (err) => {
        if (isSshPermanentError('connect_error', { message: err.message })) {
          permanentErrorRef.current = true;
          setStatus('error');
          setError(err.message);
          reject(new Error(err.message));
        } else {
          reject(new Error(err.message));
        }
      });

      socket.on('disconnect', (reason: string) => {
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
        if (cancelledRef.current || permanentErrorRef.current) return;
        if (wasConnectedRef.current && isTransientDisconnect(reason)) {
          terminal.write('\r\n\x1b[33m[Reconnecting...]\x1b[0m\r\n');
          triggerReconnect();
        } else if (!wasConnectedRef.current) {
          // Initial connection failed
          setStatus('error');
          setError('Connection lost');
        }
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- credentials/token tracked via refs
  }, [connectionId]);

  const { reconnectState, attempt, maxRetries, triggerReconnect, cancelReconnect, resetReconnect } = useAutoReconnect(
    connectSession,
  );

  // Context menu action handlers
  const handleCopy = useCallback(() => {
    if (dlpPolicyRef.current?.disableCopy) return;
    const selection = terminalRef.current?.getSelection();
    if (selection && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(selection).catch(() => {});
    }
  }, []);

  const handlePasteAction = useCallback(() => {
    if (dlpPolicyRef.current?.disablePaste) return;
    if (!navigator.clipboard?.readText) return;
    navigator.clipboard.readText().then((text) => {
      if (text && socketRef.current?.connected) {
        socketRef.current.emit('data', text);
      }
    }).catch(() => {});
  }, []);

  const handleDisconnect = useCallback(() => {
    useTabsStore.getState().closeTab(tabId);
  }, [tabId]);

  // Main mount effect: create terminal and connect
  useEffect(() => {
    if (!termRef.current) return;

    cancelledRef.current = false;
    permanentErrorRef.current = false;
    wasConnectedRef.current = false;

    const terminal = new Terminal(xtermOptionsRef.current);

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(termRef.current);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // DLP: block clipboard DOM events (right-click, Ctrl+V, middle-click) at capture phase
    const termEl = termRef.current;
    const handlePaste = (e: ClipboardEvent) => {
      if (dlpPolicyRef.current?.disablePaste) { e.preventDefault(); e.stopPropagation(); }
    };
    const handleCopy = (e: ClipboardEvent) => {
      if (dlpPolicyRef.current?.disableCopy) { e.preventDefault(); e.stopPropagation(); }
    };
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      setContextMenu({ top: e.clientY, left: e.clientX });
    };
    termEl.addEventListener('paste', handlePaste, true);
    termEl.addEventListener('copy', handleCopy, true);
    termEl.addEventListener('contextmenu', handleContextMenu);

    // Clipboard: Ctrl+Shift+C to copy, Ctrl+Shift+V to paste
    terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.type !== 'keydown') return true;

      if (event.ctrlKey && event.shiftKey && event.key === 'C') {
        if (dlpPolicyRef.current?.disableCopy) { event.preventDefault(); return false; }
        const selection = terminal.getSelection();
        if (selection && navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(selection).catch((err) => {
            console.warn('Failed to copy to clipboard:', err);
          });
        }
        event.preventDefault();
        return false;
      }

      if (event.ctrlKey && event.shiftKey && event.key === 'V') {
        if (dlpPolicyRef.current?.disablePaste) { event.preventDefault(); return false; }
        if (navigator.clipboard?.readText) {
          navigator.clipboard.readText().then((text) => {
            if (text && socketRef.current?.connected) {
              socketRef.current.emit('data', text);
            }
          }).catch((err) => {
            console.warn('Failed to read clipboard:', err);
          });
        }
        event.preventDefault();
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

    // Send terminal input to server
    terminal.onData((data) => {
      if (socketRef.current?.connected) {
        socketRef.current.emit('data', data);
      }
    });

    // Handle resize
    const handleResize = () => {
      fitAddon.fit();
      if (socketRef.current?.connected) {
        socketRef.current.emit('resize', { cols: terminal.cols, rows: terminal.rows });
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(termRef.current);

    // Start initial connection
    connectSession().catch((err: unknown) => {
      if (cancelledRef.current) return;
      if (!permanentErrorRef.current) {
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Failed to connect');
      }
    });

    return () => {
      cancelledRef.current = true;
      cancelReconnect();
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
      resizeObserver.disconnect();
      termEl.removeEventListener('paste', handlePaste, true);
      termEl.removeEventListener('copy', handleCopy, true);
      termEl.removeEventListener('contextmenu', handleContextMenu);
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
      }
      terminal.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- credentials intentionally excluded; connect once on mount
  }, [connectionId, accessToken]);

  return (
    <Box ref={containerRef} data-viewer-type="ssh" sx={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {status === 'connecting' && reconnectState === 'idle' && (
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
      {status === 'error' && reconnectState === 'idle' && (
        <Alert severity="error" sx={{ m: 1 }}>
          {error}
        </Alert>
      )}
      {reconnectState === 'reconnecting' && (
        <ReconnectOverlay state="reconnecting" attempt={attempt} maxRetries={maxRetries} protocol="SSH" />
      )}
      {reconnectState === 'failed' && (
        <ReconnectOverlay
          state="failed"
          attempt={attempt}
          maxRetries={maxRetries}
          protocol="SSH"
          onRetry={() => {
            permanentErrorRef.current = false;
            wasConnectedRef.current = true;
            triggerReconnect();
          }}
        />
      )}
      {status === 'connected' && reconnectState === 'idle' && (
        <DockedToolbar actions={toolbarActions} containerRef={containerRef} />
      )}
      <SessionContextMenu
        anchorPosition={contextMenu}
        onClose={() => setContextMenu(null)}
        protocol="SSH"
        dlpPolicy={dlpPolicy}
        onCopy={handleCopy}
        onPaste={handlePasteAction}
        onFullscreenToggle={toggleFullscreen}
        isFullscreen={isFullscreen}
        onDisconnect={handleDisconnect}
        onToggleSftp={() => togglePref('sshSftpBrowserOpen')}
        sftpAvailable={!sftpHiddenByDlp}
        sftpOpen={sftpOpen}
        container={isFullscreen ? containerRef.current : null}
      />
      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Box
          ref={termRef}
          tabIndex={-1}
          sx={{ flex: 1, overflow: 'hidden', '& .xterm': { height: '100%', padding: '4px' } }}
        />
        {!sftpHiddenByDlp && (
          <SftpBrowser
            open={sftpOpen}
            onClose={() => togglePref('sshSftpBrowserOpen')}
            socket={socketRef.current}
            disableDownload={dlpPolicy?.disableDownload}
            disableUpload={dlpPolicy?.disableUpload}
          />
        )}
      </Box>
    </Box>
  );
}
