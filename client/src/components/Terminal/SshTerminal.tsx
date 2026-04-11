import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  Maximize,
  Minimize,
  Loader2,
  FolderOpen,
} from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useTabsStore } from '../../store/tabsStore';
import { useTerminalSettingsStore } from '../../store/terminalSettingsStore';
import type { CredentialOverride } from '../../store/tabsStore';
import { useUiPreferencesStore } from '../../store/uiPreferencesStore';
import type { SshTerminalConfig } from '../../constants/terminalThemes';
import { mergeTerminalConfig, toXtermOptions, resolveThemeForMode, THEME_PRESETS } from '../../constants/terminalThemes';
import { useThemeStore } from '../../store/themeStore';
import DockedToolbar, { ToolbarAction } from '../shared/DockedToolbar';
import SessionContextMenu from '../shared/SessionContextMenu';
import ReconnectOverlay from '../shared/ReconnectOverlay';
import SftpBrowser from '../SSH/SftpBrowser';
import { useAutoReconnect } from '../../hooks/useAutoReconnect';
import { useKeyboardCapture } from '../../hooks/useKeyboardCapture';
import type { ResolvedDlpPolicy } from '../../api/connections.api';
import {
  endSshSession,
  startSshSession,
  type StartSshSessionInput,
  type StartSshSessionResponse,
} from '../../api/sessions.api';
import '@xterm/xterm/css/xterm.css';

interface SshTerminalProps {
  connectionId: string;
  tabId: string;
  isActive?: boolean;
  credentials?: CredentialOverride;
  sshTerminalConfig?: Partial<SshTerminalConfig> | null;
}

interface TerminalBrokerMessage {
  type: 'ready' | 'data' | 'pong' | 'closed' | 'error';
  data?: string;
  code?: string;
  message?: string;
}

function isTerminalTransportPermanentCode(code?: string): boolean {
  return code === 'INVALID_TOKEN'
    || code === 'SESSION_TIMEOUT'
    || code === 'SESSION_TERMINATED'
    || code === 'SESSION_CLOSED';
}

function isTransientWebSocketClose(code: number): boolean {
  return code === 1006 || code === 1011 || code === 1012 || code === 1013;
}

function resolveBrowserWebSocketUrl(session: StartSshSessionResponse): string {
  if (session.webSocketUrl) {
    return session.webSocketUrl;
  }

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${window.location.host}${session.webSocketPath}?token=${encodeURIComponent(session.token)}`;
}

export default function SshTerminal({ connectionId, tabId, isActive = true, credentials, sshTerminalConfig }: SshTerminalProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const webSocketRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [error, setError] = useState('');
  const [dlpPolicy, setDlpPolicy] = useState<ResolvedDlpPolicy | null>(null);
  const dlpPolicyRef = useRef<ResolvedDlpPolicy | null>(null);
  useEffect(() => { dlpPolicyRef.current = dlpPolicy; }, [dlpPolicy]);
  const [enforcedSshSettings, setEnforcedSshSettings] = useState<Partial<SshTerminalConfig> | null>(null);
  const [contextMenu, setContextMenu] = useState<{ top: number; left: number } | null>(null);

  const userDefaults = useTerminalSettingsStore((s) => s.userDefaults);
  const webUiMode = useThemeStore((s) => s.mode);
  const sftpOpen = useUiPreferencesStore((s) => s.sshSftpBrowserOpen);
  const setUiPref = useUiPreferencesStore((s) => s.set);

  const wasConnectedRef = useRef(false);
  const permanentErrorRef = useRef(false);
  const cancelledRef = useRef(false);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const credentialsRef = useRef(credentials);
  useEffect(() => { credentialsRef.current = credentials; }, [credentials]);

  const xtermOptions = useMemo(
    () => toXtermOptions(mergeTerminalConfig(userDefaults, sshTerminalConfig, enforcedSshSettings), webUiMode),
    [userDefaults, sshTerminalConfig, enforcedSshSettings, webUiMode],
  );
  const xtermOptionsRef = useRef(xtermOptions);
  useEffect(() => {
    xtermOptionsRef.current = xtermOptions;
  }, [xtermOptions]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    const merged = mergeTerminalConfig(userDefaults, sshTerminalConfig, enforcedSshSettings);
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
  }, [webUiMode, userDefaults, sshTerminalConfig, enforcedSshSettings]);

  const bellStyle = mergeTerminalConfig(userDefaults, sshTerminalConfig, enforcedSshSettings).bellStyle;
  const bellStyleRef = useRef(bellStyle);
  useEffect(() => {
    bellStyleRef.current = bellStyle;
  }, [bellStyle]);

  const isTransportConnected = useCallback(() => {
    return webSocketRef.current?.readyState === WebSocket.OPEN;
  }, []);

  const sendTerminalMessage = useCallback((message: Record<string, unknown>) => {
    if (webSocketRef.current?.readyState === WebSocket.OPEN) {
      webSocketRef.current.send(JSON.stringify(message));
    }
  }, []);

  const sendInitialResize = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal || !isTransportConnected()) return;
    sendTerminalMessage({ type: 'resize', cols: terminal.cols, rows: terminal.rows });
  }, [isTransportConnected, sendTerminalMessage]);

  const cleanupTransport = useCallback((options?: { endSession?: boolean }) => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }

    if (webSocketRef.current) {
      const ws = webSocketRef.current;
      webSocketRef.current = null;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'close' }));
      }
      ws.close();
    }

    if (options?.endSession && sessionIdRef.current) {
      void endSshSession(sessionIdRef.current).catch(() => {});
    }
    sessionIdRef.current = null;
  }, []);

  const applySessionPolicy = useCallback((session: StartSshSessionResponse | { dlpPolicy?: ResolvedDlpPolicy; enforcedSshSettings?: Partial<SshTerminalConfig> | null }) => {
    if (session.dlpPolicy) {
      setDlpPolicy(session.dlpPolicy);
      dlpPolicyRef.current = session.dlpPolicy;
    }
    if (session.enforcedSshSettings !== undefined) {
      setEnforcedSshSettings(session.enforcedSshSettings ?? null);
    }
  }, []);

  const { isFullscreen, toggleFullscreen } = useKeyboardCapture({
    focusRef: termRef,
    fullscreenRef: containerRef,
    isActive,
    onFullscreenChange: () => {
      setTimeout(() => {
        fitAddonRef.current?.fit();
        sendInitialResize();
      }, 100);
    },
    suppressBrowserKeys: false,
    onRequestFocus: () => terminalRef.current?.focus(),
  });

  const toolbarActions = useMemo<ToolbarAction[]>(() => {
    const actions: ToolbarAction[] = [];
    actions.push({
      id: 'sftp-browser',
      icon: <FolderOpen className="h-4 w-4" />,
      tooltip: sftpOpen ? 'Close SFTP Browser' : 'SFTP File Browser',
      onClick: () => setUiPref('sshSftpBrowserOpen', !sftpOpen),
      active: sftpOpen,
      disabled: status !== 'connected',
    });
    actions.push({
      id: 'fullscreen',
      icon: isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />,
      tooltip: isFullscreen ? 'Exit Fullscreen' : 'Fullscreen',
      onClick: toggleFullscreen,
      active: isFullscreen,
    });
    return actions;
  }, [isFullscreen, setUiPref, sftpOpen, status, toggleFullscreen]);

  const connectSession = useCallback(async () => {
    cleanupTransport();

    const terminal = terminalRef.current;
    if (!terminal) return;

    const creds = credentialsRef.current;
    const payload: StartSshSessionInput = {
      connectionId,
      ...(creds?.credentialMode === 'domain'
        ? { credentialMode: 'domain' }
        : creds && {
            username: creds.username,
            password: creds.password,
            ...(creds.domain ? { domain: creds.domain } : {}),
          }),
    };

    setStatus('connecting');
    setError('');

    const session = await startSshSession(payload);
    applySessionPolicy(session);
    sessionIdRef.current = session.sessionId;

    return await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(resolveBrowserWebSocketUrl(session));
      webSocketRef.current = ws;

      let resolved = false;
      let failedBeforeReady = false;

      const fail = (message: string, permanent = false) => {
        if (sessionIdRef.current) {
          void endSshSession(sessionIdRef.current).catch(() => {});
          sessionIdRef.current = null;
        }
        if (permanent) {
          permanentErrorRef.current = true;
        }
        setStatus('error');
        setError(message);
        if (!resolved) {
          failedBeforeReady = true;
          reject(new Error(message));
          return;
        }
        terminal.write(`\r\n\x1b[31m${message}\x1b[0m\r\n`);
      };

      ws.onmessage = (event) => {
        let message: TerminalBrokerMessage;
        try {
          message = JSON.parse(String(event.data)) as TerminalBrokerMessage;
        } catch {
          fail('Invalid terminal broker payload');
          return;
        }

        switch (message.type) {
          case 'ready': {
            const isReconnect = wasConnectedRef.current;
            wasConnectedRef.current = true;
            resolved = true;
            setStatus('connected');
            resetReconnect();
            sendInitialResize();

            heartbeatIntervalRef.current = setInterval(() => {
              if (webSocketRef.current?.readyState === WebSocket.OPEN) {
                webSocketRef.current.send(JSON.stringify({ type: 'ping' }));
              }
            }, 30_000);

            if (isReconnect) {
              terminal.write('\r\n\x1b[32m[Reconnected]\x1b[0m\r\n');
            }

            resolve();
            return;
          }
          case 'data':
            terminal.write(message.data ?? '');
            return;
          case 'pong':
            return;
          case 'closed':
            terminal.write('\r\n\x1b[33mConnection closed.\x1b[0m\r\n');
            return;
          case 'error': {
            const errorMessage = message.message || 'Terminal session failed';
            if (message.code === 'SESSION_TIMEOUT') {
              permanentErrorRef.current = true;
              setStatus('error');
              setError('Session expired due to inactivity');
              terminal.write('\r\n\x1b[31mSession expired due to inactivity.\x1b[0m\r\n');
              return;
            }
            if (message.code === 'SESSION_TERMINATED') {
              permanentErrorRef.current = true;
              cancelReconnect();
              setStatus('error');
              setError('Session terminated by administrator');
              terminal.write('\r\n\x1b[31mSession terminated by administrator.\x1b[0m\r\n');
              return;
            }
            if (isTerminalTransportPermanentCode(message.code)) {
              fail(errorMessage, true);
              return;
            }
            fail(errorMessage);
            return;
          }
        }
      };

      ws.onerror = () => {
        fail('Connection failed. Please check your credentials and try again.');
      };

      ws.onclose = (event) => {
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }

        if (cancelledRef.current || permanentErrorRef.current) {
          return;
        }

        if (failedBeforeReady) {
          return;
        }

        if (resolved && wasConnectedRef.current && isTransientWebSocketClose(event.code)) {
          terminal.write('\r\n\x1b[33m[Reconnecting...]\x1b[0m\r\n');
          triggerReconnect();
          return;
        }

        if (resolved && wasConnectedRef.current) {
          terminal.write('\r\n\x1b[33m[Reconnecting...]\x1b[0m\r\n');
          triggerReconnect();
          return;
        }

        fail('Connection lost');
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reconnect helpers are stable and credentials are tracked via refs
  }, [applySessionPolicy, cleanupTransport, connectionId, sendInitialResize]);

  const { reconnectState, attempt, maxRetries, triggerReconnect, cancelReconnect, resetReconnect } = useAutoReconnect(
    connectSession,
  );

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
      if (text && isTransportConnected()) {
        sendTerminalMessage({ type: 'input', data: text });
      }
    }).catch(() => {});
  }, [isTransportConnected, sendTerminalMessage]);

  const handleDisconnect = useCallback(() => {
    useTabsStore.getState().closeTab(tabId);
  }, [tabId]);

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

    const termEl = termRef.current;
    const handlePaste = (event: ClipboardEvent) => {
      if (dlpPolicyRef.current?.disablePaste) { event.preventDefault(); event.stopPropagation(); }
    };
    const handleCopyEvent = (event: ClipboardEvent) => {
      if (dlpPolicyRef.current?.disableCopy) { event.preventDefault(); event.stopPropagation(); }
    };
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      setContextMenu({ top: event.clientY, left: event.clientX });
    };
    termEl.addEventListener('paste', handlePaste, true);
    termEl.addEventListener('copy', handleCopyEvent, true);
    termEl.addEventListener('contextmenu', handleContextMenu);

    terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.type !== 'keydown') return true;

      if (event.ctrlKey && event.shiftKey && event.key === 'C') {
        if (dlpPolicyRef.current?.disableCopy) { event.preventDefault(); return false; }
        const selection = terminal.getSelection();
        if (selection && navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(selection).catch(() => {});
        }
        event.preventDefault();
        return false;
      }

      if (event.ctrlKey && event.shiftKey && event.key === 'V') {
        if (dlpPolicyRef.current?.disablePaste) { event.preventDefault(); return false; }
        if (navigator.clipboard?.readText) {
          navigator.clipboard.readText().then((text) => {
            if (text && isTransportConnected()) {
              sendTerminalMessage({ type: 'input', data: text });
            }
          }).catch(() => {});
        }
        event.preventDefault();
        return false;
      }

      return true;
    });

    terminal.onBell(() => {
      if (bellStyleRef.current === 'sound') {
        try { new Audio('data:audio/wav;base64,UklGRl9vT19teleVhZUAAQABADS...').play().catch(() => {}); } catch { /* ignore */ }
      } else if (bellStyleRef.current === 'visual') {
        const element = termRef.current;
        if (element) {
          element.style.outline = '2px solid #ff9800';
          setTimeout(() => { element.style.outline = ''; }, 150);
        }
      }
    });

    terminal.onData((data) => {
      if (isTransportConnected()) {
        sendTerminalMessage({ type: 'input', data });
      }
    });

    const handleResize = () => {
      fitAddon.fit();
      sendInitialResize();
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(termRef.current);

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
      resizeObserver.disconnect();
      termEl.removeEventListener('paste', handlePaste, true);
      termEl.removeEventListener('copy', handleCopyEvent, true);
      termEl.removeEventListener('contextmenu', handleContextMenu);
      cleanupTransport({ endSession: true });
      terminal.dispose();
    };
  }, [connectionId, connectSession, cleanupTransport, cancelReconnect, isTransportConnected, sendInitialResize, sendTerminalMessage]);

  return (
    <div ref={containerRef} data-viewer-type="ssh" className="flex flex-1 flex-row relative overflow-hidden">
      {status === 'connected' && reconnectState === 'idle' && (
        <DockedToolbar actions={toolbarActions} />
      )}
      <div className="flex flex-1 flex-col min-w-0 relative">
      {status === 'connecting' && reconnectState === 'idle' && (
        <div className="absolute inset-0 flex items-center justify-center z-10 bg-black/70">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          <span>Connecting...</span>
        </div>
      )}
      {status === 'error' && reconnectState === 'idle' && (
        <div className="m-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
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
        onToggleSftp={() => setUiPref('sshSftpBrowserOpen', !sftpOpen)}
        sftpAvailable
        sftpOpen={sftpOpen}
        container={isFullscreen ? containerRef.current : null}
      />
      <div className="flex flex-1 overflow-hidden">
        <div
          ref={termRef}
          tabIndex={-1}
          className="flex-1 overflow-hidden [&_.xterm]:h-full [&_.xterm]:p-1"
        />
        <SftpBrowser
          open={sftpOpen}
          onClose={() => setUiPref('sshSftpBrowserOpen', false)}
          connectionId={connectionId}
          credentials={credentials}
          disableDownload={dlpPolicy?.disableDownload}
          disableUpload={dlpPolicy?.disableUpload}
        />
      </div>
      </div>{/* end inner content column */}
    </div>
  );
}
