import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Box,
  CircularProgress,
  Typography,
  Alert,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Tab,
  Tabs,
} from '@mui/material';
import {
  PlayArrow as RunIcon,
  Stop as StopIcon,
  Storage as SchemaIcon,
  Fullscreen as FullscreenIcon,
  FullscreenExit as FullscreenExitIcon,
  Code as FormatIcon,
  PowerSettingsNew as DisconnectIcon,
  Download as ExportIcon,
  AccountTree as VisualizerIcon,
  History as HistoryIcon,
  SaveAlt as SaveIcon,
  Add as AddIcon,
  Close as CloseIcon,
  Refresh as ReconnectIcon,
  Tune as TuneIcon,
} from '@mui/icons-material';
import Editor, { type OnMount, type Monaco } from '@monaco-editor/react';
import type * as monacoNs from 'monaco-editor';
import api from '../../api/client';
import type { CredentialOverride } from '../../store/tabsStore';
import type { DbQueryResult, DbSchemaInfo, DbSessionConfig } from '../../api/database.api';
import { createDbSession, endDbSession, dbSessionHeartbeat, updateDbSessionConfig } from '../../api/database.api';
import { extractApiError } from '../../utils/apiError';
import { useUiPreferencesStore } from '../../store/uiPreferencesStore';
import { useAutoReconnect } from '../../hooks/useAutoReconnect';
import ReconnectOverlay from '../shared/ReconnectOverlay';
import { useThemeStore } from '../../store/themeStore';
import DockedToolbar, { ToolbarAction } from '../shared/DockedToolbar';
import DbConnectionStatus, { DbConnectionState } from './DbConnectionStatus';
import DbResultsTable from './DbResultsTable';
import DbSchemaBrowser from './DbSchemaBrowser';
import QueryVisualizer from './QueryVisualizer';
import DbQueryHistory, { addSavedQuery, deriveQueryLabel } from './DbQueryHistory';
import DbSessionConfigPopover from './DbSessionConfigPopover';
import { createSqlCompletionProvider } from './sqlCompletionProvider';
import { validateSql } from './sqlValidation';

interface DbEditorProps {
  connectionId: string;
  tabId: string;
  isActive?: boolean;
  credentials?: CredentialOverride;
}

interface QuerySubTab {
  id: string;
  label: string;
  sql: string;
  result: DbQueryResult | null;
  executing: boolean;
}

let subTabCounter = 0;

function createSubTab(): QuerySubTab {
  subTabCounter += 1;
  return {
    id: `qtab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    label: `Query ${subTabCounter}`,
    sql: '',
    result: null,
    executing: false,
  };
}

function stripLeadingComments(s: string): string {
  let r = s.trim();
  for (;;) {
    if (r.startsWith('--')) {
      const nl = r.indexOf('\n');
      r = (nl === -1 ? '' : r.slice(nl + 1)).trimStart();
    } else if (r.startsWith('/*')) {
      const end = r.indexOf('*/');
      r = (end === -1 ? '' : r.slice(end + 2)).trimStart();
    } else break;
  }
  return r;
}

function classifyQueryType(sql: string): string {
  const t = stripLeadingComments(sql);
  if (/^SELECT\b/i.test(t)) return 'SELECT';
  if (/^INSERT\b/i.test(t)) return 'INSERT';
  if (/^UPDATE\b/i.test(t)) return 'UPDATE';
  if (/^DELETE\b/i.test(t)) return 'DELETE';
  if (/^(CREATE|ALTER|DROP|TRUNCATE)\b/i.test(t)) return 'DDL';
  if (/^WITH\b/i.test(t)) {
    if (/\)\s*INSERT\b/i.test(t)) return 'INSERT';
    if (/\)\s*UPDATE\b/i.test(t)) return 'UPDATE';
    if (/\)\s*DELETE\b/i.test(t)) return 'DELETE';
    return 'SELECT';
  }
  if (/^(EXPLAIN|DESCRIBE|DESC|SHOW)\b/i.test(t)) return 'SELECT';
  if (/^(GRANT|REVOKE|SET)\b/i.test(t)) return 'DDL';
  if (/^MERGE\b/i.test(t)) return 'UPDATE';
  if (/^(CALL|EXEC|EXECUTE)\b/i.test(t)) return 'EXEC';
  return 'OTHER';
}

export default function DbEditor({
  connectionId,
  tabId,
  isActive = true,
  credentials,
}: DbEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const monacoEditorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const completionDisposableRef = useRef<monacoNs.IDisposable | null>(null);
  const validationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const editorPaneRef = useRef<HTMLDivElement>(null);
  const resultsPaneRef = useRef<HTMLDivElement>(null);
  const handleRunQueryRef = useRef<() => void>(() => {});
  const activeQueryTabIdRef = useRef<string>('');
  const queryTabsRef = useRef<QuerySubTab[]>([]);

  // Store selectors — must be declared before any useState that depends on them
  const storedSubTabs = useUiPreferencesStore((s) => s.dbQuerySubTabs[connectionId]);
  const storedSessionConfig = useUiPreferencesStore((s) => s.dbSessionConfigs[connectionId]);
  const schemaBrowserOpen = useUiPreferencesStore((s) => s.dbSchemaBrowserOpen);
  const historyOpen = useUiPreferencesStore((s) => s.dbQueryHistoryOpen);
  const setPref = useUiPreferencesStore((s) => s.set);

  const [connectionState, setConnectionState] = useState<DbConnectionState>('connecting');
  const [error, setError] = useState('');
  const [protocol, setProtocol] = useState('postgresql');
  const [databaseName, setDatabaseName] = useState<string | undefined>();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [schemaData, setSchemaData] = useState<DbSchemaInfo>({ tables: [] });
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [visualizerOpen, setVisualizerOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [configAnchorEl, setConfigAnchorEl] = useState<HTMLElement | null>(null);
  const [currentSessionConfig, setCurrentSessionConfig] = useState<DbSessionConfig>(
    () => storedSessionConfig ?? {},
  );

  const [queryTabs, setQueryTabs] = useState<QuerySubTab[]>(() => {
    if (storedSubTabs?.tabs?.length) {
      // Restore persisted tabs (without results/executing state)
      const restored = storedSubTabs.tabs.map((t) => ({
        ...t,
        result: null as DbQueryResult | null,
        executing: false,
      }));
      // Sync the counter so new tabs get unique labels
      const maxNum = restored.reduce((max, t) => {
        const m = t.label.match(/^Query (\d+)$/);
        return m ? Math.max(max, parseInt(m[1], 10)) : max;
      }, 0);
      if (maxNum > subTabCounter) subTabCounter = maxNum;
      return restored;
    }
    return [createSubTab()];
  });
  const [activeQueryTabId, setActiveQueryTabId] = useState(() => {
    if (storedSubTabs?.activeId && queryTabs.some((t) => t.id === storedSubTabs.activeId)) {
      return storedSubTabs.activeId;
    }
    return queryTabs[0].id;
  });

  const sqlEditorTheme = useUiPreferencesStore((s) => s.sqlEditorTheme);
  const sqlEditorFontSize = useUiPreferencesStore((s) => s.sqlEditorFontSize);
  const sqlEditorFontFamily = useUiPreferencesStore((s) => s.sqlEditorFontFamily);
  const sqlEditorMinimap = useUiPreferencesStore((s) => s.sqlEditorMinimap);
  const themeMode = useThemeStore((s) => s.mode);

  const [historyRefresh, setHistoryRefresh] = useState(0);
  const wasConnectedRef = useRef(false);
  const mountedRef = useRef(true);

  // Persist query sub-tabs to store (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      setPref('dbQuerySubTabs', {
        ...useUiPreferencesStore.getState().dbQuerySubTabs,
        [connectionId]: {
          tabs: queryTabs.map(({ id, label, sql }) => ({ id, label, sql })),
          activeId: activeQueryTabId,
        },
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [queryTabs, activeQueryTabId, connectionId, setPref]);

  // Persist session config to store
  useEffect(() => {
    const prev = useUiPreferencesStore.getState().dbSessionConfigs;
    const hasValues = Object.values(currentSessionConfig).some((v) => v !== undefined && v !== '');
    if (hasValues) {
      setPref('dbSessionConfigs', { ...prev, [connectionId]: currentSessionConfig });
    } else {
      const { [connectionId]: _, ...rest } = prev;
      void _;
      setPref('dbSessionConfigs', rest);
    }
  }, [currentSessionConfig, connectionId, setPref]);

  // Derived active tab
  const activeTab = queryTabs.find((t) => t.id === activeQueryTabId) ?? queryTabs[0];

  // Keep refs in sync so callbacks always read the latest state
  activeQueryTabIdRef.current = activeQueryTabId;
  queryTabsRef.current = queryTabs;

  // Helper to update a specific tab
  const updateTab = useCallback((targetTabId: string, patch: Partial<QuerySubTab>) => {
    setQueryTabs((prev) => prev.map((t) => t.id === targetTabId ? { ...t, ...patch } : t));
  }, []);

  // --- Resizable split (editor / results) — direct DOM for performance ---
  const splitRatio = useUiPreferencesStore((s) => s.dbEditorSplitRatio);

  const handleSplitDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = splitContainerRef.current;
    const editorPane = editorPaneRef.current;
    const resultsPane = resultsPaneRef.current;
    if (!container || !editorPane || !resultsPane) return;

    const startY = e.clientY;
    const containerRect = container.getBoundingClientRect();
    const startEditorFr = editorPane.getBoundingClientRect().height / containerRect.height;
    let lastEditorFr = startEditorFr;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = (ev.clientY - startY) / containerRect.height;
      lastEditorFr = Math.min(0.85, Math.max(0.10, startEditorFr + delta));
      editorPane.style.flex = `${lastEditorFr} 1 0%`;
      resultsPane.style.flex = `${1 - lastEditorFr} 1 0%`;
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setPref('dbEditorSplitRatio', lastEditorFr);
    };

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [setPref]);

  // --- Connection helper (used for initial connect + reconnect) ---
  const connectSession = useCallback(async () => {
    // Clean up any stale heartbeat / session before (re)connecting
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }

    setConnectionState('connecting');
    setError('');

    const result = await createDbSession({
      connectionId,
      ...(credentials && {
        username: credentials.username,
        password: credentials.password,
      }),
      ...(Object.keys(currentSessionConfig).length > 0 && { sessionConfig: currentSessionConfig }),
    });

    if (!mountedRef.current) {
      endDbSession(result.sessionId).catch(() => {});
      return;
    }

    sessionIdRef.current = result.sessionId;
    setProtocol(result.protocol);
    setDatabaseName(result.databaseName);
    setConnectionState('connected');
    wasConnectedRef.current = true;

    // Apply sensible defaults when no stored session config exists
    if (Object.keys(currentSessionConfig).length === 0 && result.protocol !== 'mongodb') {
      const defaults: DbSessionConfig = {};
      defaults.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (result.databaseName) {
        defaults.activeDatabase = result.databaseName;
        defaults.searchPath = result.databaseName;
      }
      setCurrentSessionConfig(defaults);
      // Apply defaults to the live session
      updateDbSessionConfig(result.sessionId, defaults).catch(() => {});
    }

    // Start heartbeat
    heartbeatRef.current = setInterval(() => {
      if (sessionIdRef.current) {
        dbSessionHeartbeat(sessionIdRef.current).catch((err) => {
          if (err?.response?.status === 410) {
            // Session expired — try to reconnect
            if (heartbeatRef.current) {
              clearInterval(heartbeatRef.current);
              heartbeatRef.current = null;
            }
            sessionIdRef.current = null;
            if (wasConnectedRef.current) {
              triggerReconnect();
            }
          }
        });
      }
    }, 15_000);
  }, [connectionId, credentials]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Auto-reconnect hook ---
  const {
    reconnectState,
    attempt: reconnectAttempt,
    maxRetries: reconnectMaxRetries,
    triggerReconnect,
    cancelReconnect,
    resetReconnect,
  } = useAutoReconnect(connectSession);

  // Reset reconnect state when connection succeeds
  useEffect(() => {
    if (connectionState === 'connected' && reconnectState === 'reconnecting') {
      resetReconnect();
    }
  }, [connectionState, reconnectState, resetReconnect]);

  // Mark failed reconnect as error state
  useEffect(() => {
    if (reconnectState === 'failed') {
      setConnectionState('error');
      setError('Reconnection failed. Click Retry or close the tab.');
    }
  }, [reconnectState]);

  // Initial connection on mount
  useEffect(() => {
    mountedRef.current = true;
    connectSession().catch((err) => {
      if (!mountedRef.current) return;
      setConnectionState('error');
      setError(extractApiError(err, 'Failed to connect to database'));
    });

    return () => {
      mountedRef.current = false;
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      if (sessionIdRef.current) {
        endDbSession(sessionIdRef.current).catch(() => {});
        sessionIdRef.current = null;
      }
      cancelReconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  // Execute query — reads from refs to avoid stale closures in Monaco keybinding
  const handleRunQuery = useCallback(async () => {
    const currentTabs = queryTabsRef.current;
    const currentActiveId = activeQueryTabIdRef.current;
    const tab = currentTabs.find((t) => t.id === currentActiveId);
    if (!sessionIdRef.current || !tab?.sql.trim() || tab.executing) return;
    const capturedTabId = tab.id;
    updateTab(capturedTabId, { executing: true, result: null });
    try {
      const result = await api.post(`/sessions/database/${sessionIdRef.current}/query`, {
        sql: tab.sql.trim(),
      });
      updateTab(capturedTabId, { result: result.data as DbQueryResult, executing: false });
      // Trigger history panel refresh
      setHistoryRefresh((n) => n + 1);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if ((status === 404 || status === 410) && wasConnectedRef.current) {
        // Session lost — trigger reconnect
        sessionIdRef.current = null;
        if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
        triggerReconnect();
      }
      updateTab(capturedTabId, {
        result: { columns: [], rows: [], rowCount: 0, durationMs: 0, truncated: false },
        executing: false,
      });
      setError(extractApiError(err, 'Query execution failed'));
    }
  }, [updateTab, triggerReconnect]);

  // Keep ref in sync so Monaco keybinding always calls the latest handleRunQuery
  handleRunQueryRef.current = handleRunQuery;

  // Refresh schema
  const handleRefreshSchema = useCallback(async () => {
    if (!sessionIdRef.current) return;
    setSchemaLoading(true);
    try {
      const res = await api.get(`/sessions/database/${sessionIdRef.current}/schema`);
      setSchemaData(res.data as DbSchemaInfo);
    } catch {
      // Schema fetch is best-effort
    } finally {
      setSchemaLoading(false);
    }
  }, []);

  // Auto-load schema when connected
  useEffect(() => {
    if (connectionState === 'connected') handleRefreshSchema();
  }, [connectionState, handleRefreshSchema]);

  // Derive table list for SQL completion provider
  const schemaTables = schemaData.tables;

  // Resolve Monaco theme from user preference and WebUI mode
  const resolvedMonacoTheme = sqlEditorTheme === 'auto'
    ? (themeMode === 'dark' ? 'vs-dark' : 'vs')
    : sqlEditorTheme;

  // Register custom Monaco themes and completion provider on mount
  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    monacoEditorRef.current = editor;
    monacoRef.current = monaco;

    // Define custom themes
    monaco.editor.defineTheme('dracula', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: 'ff79c6', fontStyle: 'bold' },
        { token: 'string', foreground: 'f1fa8c' },
        { token: 'number', foreground: 'bd93f9' },
        { token: 'comment', foreground: '6272a4', fontStyle: 'italic' },
        { token: 'type', foreground: '8be9fd', fontStyle: 'italic' },
        { token: 'operator', foreground: 'ff79c6' },
      ],
      colors: {
        'editor.background': '#282a36',
        'editor.foreground': '#f8f8f2',
        'editor.selectionBackground': '#44475a',
        'editor.lineHighlightBackground': '#44475a',
        'editorCursor.foreground': '#f8f8f0',
      },
    });

    monaco.editor.defineTheme('solarized', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: '859900', fontStyle: 'bold' },
        { token: 'string', foreground: '2aa198' },
        { token: 'number', foreground: 'd33682' },
        { token: 'comment', foreground: '93a1a1', fontStyle: 'italic' },
        { token: 'type', foreground: 'b58900' },
        { token: 'operator', foreground: '859900' },
      ],
      colors: {
        'editor.background': '#fdf6e3',
        'editor.foreground': '#657b83',
        'editor.selectionBackground': '#eee8d5',
        'editor.lineHighlightBackground': '#eee8d5',
        'editorCursor.foreground': '#657b83',
      },
    });

    // Register Ctrl+Enter keybinding for query execution
    // Use ref to avoid stale closure — the action is registered once at mount,
    // but handleRunQueryRef always points to the latest handleRunQuery.
    editor.addAction({
      id: 'run-sql-query',
      label: 'Run SQL Query',
      keybindings: [
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
      ],
      run: () => { handleRunQueryRef.current(); },
    });

    // Register F5 keybinding for query execution
    editor.addAction({
      id: 'run-sql-query-f5',
      label: 'Run SQL Query (F5)',
      keybindings: [
        monaco.KeyCode.F5,
      ],
      run: () => { handleRunQueryRef.current(); },
    });

    // Register completion provider with current schema
    completionDisposableRef.current = monaco.languages.registerCompletionItemProvider(
      'sql',
      createSqlCompletionProvider(monaco, schemaTables),
    );

    // Apply the resolved theme
    monaco.editor.setTheme(resolvedMonacoTheme);
  }, [schemaTables, resolvedMonacoTheme]) as OnMount;

  // Re-register completion provider when schema changes
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;

    // Dispose old provider and register updated one
    completionDisposableRef.current?.dispose();
    completionDisposableRef.current = monaco.languages.registerCompletionItemProvider(
      'sql',
      createSqlCompletionProvider(monaco, schemaTables),
    );
  }, [schemaTables]);

  // Sync Monaco theme when preferences or WebUI mode change
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    monaco.editor.setTheme(resolvedMonacoTheme);
  }, [resolvedMonacoTheme]);

  // Run SQL validation on debounced content change — reads activeQueryTabId from ref
  const handleEditorChange = useCallback((value: string | undefined) => {
    updateTab(activeQueryTabIdRef.current, { sql: value ?? '' });

    // Debounced validation (300ms)
    if (validationTimerRef.current) {
      clearTimeout(validationTimerRef.current);
    }
    validationTimerRef.current = setTimeout(() => {
      const monaco = monacoRef.current;
      const editor = monacoEditorRef.current;
      if (monaco && editor) {
        const model = editor.getModel();
        if (model) validateSql(monaco, model);
      }
    }, 300);
  }, [updateTab]);

  // Cleanup validation timer and completion provider on unmount
  useEffect(() => {
    return () => {
      if (validationTimerRef.current) clearTimeout(validationTimerRef.current);
      completionDisposableRef.current?.dispose();
    };
  }, []);

  // Handle table click from schema browser — insert SELECT query
  const handleTableClick = useCallback((tableName: string, schemaName: string) => {
    const qualifiedName = schemaName === 'public' ? tableName : `${schemaName}.${tableName}`;
    const limit = protocol === 'oracle' ? 'FETCH FIRST 100 ROWS ONLY'
      : protocol === 'mssql' ? '-- use SELECT TOP 100'
      : 'LIMIT 100';
    updateTab(activeQueryTabId, {
      sql: activeTab.sql.trim()
        ? activeTab.sql
        : protocol === 'mssql'
          ? `SELECT TOP 100 * FROM ${qualifiedName};`
          : `SELECT * FROM ${qualifiedName}\n${limit};`,
    });
  }, [protocol, activeQueryTabId, activeTab, updateTab]);

  // Handle generated SQL from schema browser context menu
  const handleInsertSql = useCallback((sql: string) => {
    updateTab(activeQueryTabId, { sql: activeTab.sql.trim() ? `${activeTab.sql}\n${sql}` : sql });
  }, [activeQueryTabId, activeTab, updateTab]);

  const openSaveDialog = useCallback(() => {
    if (!activeTab.sql.trim()) return;
    setSaveName(deriveQueryLabel(activeTab.sql));
    setSaveDialogOpen(true);
  }, [activeTab]);

  const handleSaveQuery = useCallback(() => {
    if (!saveName.trim() || !activeTab.sql.trim()) return;
    addSavedQuery(connectionId, saveName.trim(), activeTab.sql.trim());
    updateTab(activeQueryTabId, { label: saveName.trim() });
    setSaveDialogOpen(false);
    setSaveName('');
    setHistoryRefresh((n) => n + 1);
  }, [saveName, activeTab, connectionId, activeQueryTabId, updateTab]);

  // Format SQL — uppercase keywords via Monaco or fallback
  const handleFormatSql = useCallback(() => {
    const editor = monacoEditorRef.current;
    if (editor) {
      // Try Monaco's built-in format action first
      const formatAction = editor.getAction('editor.action.formatDocument');
      if (formatAction) {
        formatAction.run();
        return;
      }
    }
    // Fallback: basic keyword uppercasing
    const keywords = [
      'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'ORDER BY', 'GROUP BY',
      'HAVING', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'OUTER JOIN',
      'ON', 'AS', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM',
      'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'LIMIT', 'OFFSET',
      'DISTINCT', 'UNION', 'EXCEPT', 'INTERSECT', 'IN', 'NOT', 'NULL',
      'IS', 'LIKE', 'BETWEEN', 'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
    ];
    let formatted = activeTab.sql;
    for (const kw of keywords) {
      // eslint-disable-next-line security/detect-non-literal-regexp
      const regex = new RegExp(`\\b${kw.replace(/ /g, '\\s+')}\\b`, 'gi');
      formatted = formatted.replace(regex, kw);
    }
    updateTab(activeQueryTabId, { sql: formatted });
  }, [activeTab, activeQueryTabId, updateTab]);

  // Export results as CSV
  const handleExportCsv = useCallback(() => {
    const qr = activeTab.result;
    if (!qr || qr.columns.length === 0) return;

    const header = qr.columns.join(',');
    const rows = qr.rows.map((row) =>
      qr.columns
        .map((col) => {
          const val = row[col];
          if (val === null || val === undefined) return '';
          const str = String(val);
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        })
        .join(','),
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `query-results-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [activeTab]);

  // Fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
      setIsFullscreen(false);
    } else {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    }
  }, []);

  // Disconnect
  const handleDisconnect = useCallback(async () => {
    if (sessionIdRef.current) {
      await endDbSession(sessionIdRef.current).catch(() => {});
      sessionIdRef.current = null;
    }
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    setConnectionState('disconnected');
  }, []);

  // Build toolbar actions
  const toolbarActions: ToolbarAction[] = [
    {
      id: 'run-query',
      icon: activeTab.executing ? <StopIcon /> : <RunIcon />,
      tooltip: activeTab.executing ? 'Cancel query' : 'Run query (Ctrl+Enter)',
      onClick: handleRunQuery,
      active: activeTab.executing,
      disabled: connectionState !== 'connected' || !activeTab.sql.trim(),
    },
    {
      id: 'format-sql',
      icon: <FormatIcon />,
      tooltip: 'Format SQL',
      onClick: handleFormatSql,
      disabled: connectionState !== 'connected',
    },
    {
      id: 'save-query',
      icon: <SaveIcon />,
      tooltip: 'Save query (Ctrl+S)',
      onClick: openSaveDialog,
      disabled: !activeTab.sql.trim(),
    },
    {
      id: 'schema-browser',
      icon: <SchemaIcon />,
      tooltip: schemaBrowserOpen ? 'Hide schema browser' : 'Show schema browser',
      onClick: () => {
        const newVal = !schemaBrowserOpen;
        setPref('dbSchemaBrowserOpen', newVal);
        if (newVal) handleRefreshSchema();
      },
      active: schemaBrowserOpen,
    },
    {
      id: 'query-history',
      icon: <HistoryIcon />,
      tooltip: historyOpen ? 'Hide query history' : 'Show query history',
      onClick: () => setPref('dbQueryHistoryOpen', !historyOpen),
      active: historyOpen,
    },
    {
      id: 'export-csv',
      icon: <ExportIcon />,
      tooltip: 'Export results as CSV',
      onClick: handleExportCsv,
      disabled: !activeTab.result || activeTab.result.columns.length === 0,
    },
    {
      id: 'query-visualizer',
      icon: <VisualizerIcon />,
      tooltip: 'Query visualizer',
      onClick: () => setVisualizerOpen(true),
      disabled: !activeTab.result || !activeTab.sql.trim(),
      active: visualizerOpen,
    },
    {
      id: 'fullscreen',
      icon: isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />,
      tooltip: isFullscreen ? 'Exit fullscreen' : 'Fullscreen',
      onClick: toggleFullscreen,
    },
    {
      id: 'disconnect',
      icon: <DisconnectIcon />,
      tooltip: 'Disconnect',
      onClick: handleDisconnect,
      color: 'error.main',
      disabled: connectionState !== 'connected',
    },
  ];

  // Suppress unused var lint for tabId and isActive
  void tabId;
  void isActive;

  return (
    <Box
      ref={containerRef}
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        bgcolor: 'background.default',
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      {/* Status bar */}
      <Box
        sx={{
          px: 1.5,
          py: 0.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <DbConnectionStatus
          state={connectionState}
          protocol={protocol}
          databaseName={databaseName}
          error={connectionState === 'error' ? error : undefined}
          hasSessionConfig={Object.values(currentSessionConfig).some((v) => v !== undefined)}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {connectionState === 'connected' && protocol !== 'mongodb' && (
            <Tooltip title="Session settings">
              <IconButton
                size="small"
                onClick={(e) => setConfigAnchorEl(e.currentTarget)}
                color={Object.values(currentSessionConfig).some((v) => v !== undefined) ? 'primary' : 'default'}
              >
                <TuneIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          )}
          {(connectionState === 'error' || connectionState === 'disconnected') && (
            <Tooltip title="Reconnect">
              <IconButton
                size="small"
                onClick={() => {
                  resetReconnect();
                  connectSession().catch((err) => {
                    if (!mountedRef.current) return;
                    setConnectionState('error');
                    setError(extractApiError(err, 'Reconnection failed'));
                  });
                }}
                color="warning"
              >
                <ReconnectIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Run query (Ctrl+Enter)">
            <span>
              <IconButton
                size="small"
                onClick={handleRunQuery}
                disabled={connectionState !== 'connected' || !activeTab.sql.trim() || activeTab.executing}
                color="primary"
              >
                {activeTab.executing ? <CircularProgress size={16} /> : <RunIcon sx={{ fontSize: 18 }} />}
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Box>

      {/* Query sub-tabs */}
      {connectionState === 'connected' && (
        <Box sx={{ display: 'flex', alignItems: 'center', borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', minHeight: 32 }}>
          <Tabs
            value={activeQueryTabId}
            onChange={(_, id) => setActiveQueryTabId(id as string)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ minHeight: 32, flex: 1, '& .MuiTab-root': { minHeight: 32, py: 0, px: 1.5, textTransform: 'none', fontSize: '0.75rem' } }}
          >
            {queryTabs.map((tab) => (
              <Tab
                key={tab.id}
                value={tab.id}
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {tab.executing && <CircularProgress size={10} />}
                    <span>{tab.label}</span>
                    {queryTabs.length > 1 && (
                      <CloseIcon
                        sx={{ fontSize: 14, ml: 0.5, opacity: 0.5, '&:hover': { opacity: 1 } }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setQueryTabs((prev) => {
                            const filtered = prev.filter((t) => t.id !== tab.id);
                            if (activeQueryTabId === tab.id) {
                              setActiveQueryTabId(filtered[Math.max(0, filtered.length - 1)].id);
                            }
                            return filtered;
                          });
                        }}
                      />
                    )}
                  </Box>
                }
              />
            ))}
          </Tabs>
          <Tooltip title="New query tab">
            <IconButton size="small" onClick={() => {
              const newTab = createSubTab();
              setQueryTabs((prev) => [...prev, newTab]);
              setActiveQueryTabId(newTab.id);
            }} sx={{ mx: 0.5 }}>
              <AddIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Box>
      )}

      {/* Connecting overlay */}
      {connectionState === 'connecting' && reconnectState === 'idle' && (
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
            bgcolor: 'rgba(0,0,0,0.5)',
          }}
        >
          <CircularProgress size={24} sx={{ mr: 1 }} />
          <Typography>Connecting to database...</Typography>
        </Box>
      )}

      {/* Reconnect overlay */}
      {(reconnectState === 'reconnecting' || reconnectState === 'failed') && (
        <ReconnectOverlay
          state={reconnectState}
          attempt={reconnectAttempt}
          maxRetries={reconnectMaxRetries}
          protocol="DATABASE"
          onRetry={triggerReconnect}
        />
      )}

      {/* Error alert */}
      {connectionState === 'error' && (
        <Alert severity="error" sx={{ m: 1 }}>
          {error}
        </Alert>
      )}

      {/* Main content area */}
      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden', minWidth: 0, minHeight: 0 }}>
        {/* Editor + Results (resizable split) */}
        <Box ref={splitContainerRef} sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          {/* SQL editor area */}
          <Box
            ref={editorPaneRef}
            sx={{
              flex: `${splitRatio} 1 0%`,
              minHeight: 80,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <Editor
              language="sql"
              theme={resolvedMonacoTheme}
              value={activeTab.sql}
              onChange={handleEditorChange}
              onMount={handleEditorMount}
              options={{
                fontSize: sqlEditorFontSize,
                fontFamily: sqlEditorFontFamily,
                minimap: { enabled: sqlEditorMinimap },
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                automaticLayout: true,
                suggestOnTriggerCharacters: true,
                quickSuggestions: true,
                tabSize: 2,
                renderLineHighlight: 'line',
                fixedOverflowWidgets: true,
                scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
                padding: { top: 8, bottom: 8 },
                placeholder: 'Enter SQL query here... (Ctrl+Enter to execute)',
              }}
              loading={
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
                  <CircularProgress size={20} />
                </Box>
              }
            />
          </Box>

          {/* Drag handle */}
          <Box
            onMouseDown={handleSplitDragStart}
            sx={{
              height: 4,
              cursor: 'row-resize',
              bgcolor: 'divider',
              flexShrink: 0,
              '&:hover': { bgcolor: 'primary.main' },
              transition: 'background-color 0.15s',
            }}
          />

          {/* Results area */}
          <Box ref={resultsPaneRef} sx={{ flex: `${1 - splitRatio} 1 0%`, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 40 }}>
            {activeTab.executing && (
              <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={16} />
                <Typography variant="body2" color="text.secondary">
                  Executing query...
                </Typography>
              </Box>
            )}

            {!activeTab.executing && activeTab.result && (
              <DbResultsTable
                columns={activeTab.result.columns}
                rows={activeTab.result.rows}
                rowCount={activeTab.result.rowCount}
                durationMs={activeTab.result.durationMs}
                truncated={activeTab.result.truncated}
              />
            )}

            {!activeTab.executing && !activeTab.result && connectionState === 'connected' && (
              <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  Write a SQL query and press Ctrl+Enter to execute
                </Typography>
              </Box>
            )}
          </Box>
        </Box>

        {/* Schema browser */}
        <DbSchemaBrowser
          schema={schemaData}
          open={schemaBrowserOpen}
          onClose={() => setPref('dbSchemaBrowserOpen', false)}
          onRefresh={handleRefreshSchema}
          onTableClick={handleTableClick}
          onInsertSql={handleInsertSql}
          dbProtocol={protocol}
          loading={schemaLoading}
        />

        {/* Query history sidebar */}
        <DbQueryHistory
          open={historyOpen}
          onClose={() => setPref('dbQueryHistoryOpen', false)}
          sessionId={sessionIdRef.current}
          connectionId={connectionId}
          onSelectQuery={(sql) => updateTab(activeQueryTabId, { sql })}
          refreshTrigger={historyRefresh}
        />
      </Box>

      {/* Docked toolbar */}
      {connectionState === 'connected' && (
        <DockedToolbar actions={toolbarActions} containerRef={containerRef} />
      )}

      {/* Query visualizer drawer */}
      <QueryVisualizer
        open={visualizerOpen}
        onClose={() => setVisualizerOpen(false)}
        queryText={activeTab.sql}
        queryType={classifyQueryType(activeTab.sql)}
        executionTimeMs={activeTab.result?.durationMs ?? null}
        rowsAffected={activeTab.result?.rowCount ?? null}
        tablesAccessed={[]}
        blocked={false}
        sessionId={sessionIdRef.current ?? undefined}
        dbProtocol={protocol}
        onApplySql={(optimizedSql) => {
          updateTab(activeQueryTabId, { sql: optimizedSql });
          setVisualizerOpen(false);
        }}
      />

      {/* Session config popover */}
      <DbSessionConfigPopover
        open={!!configAnchorEl}
        anchorEl={configAnchorEl}
        onClose={() => setConfigAnchorEl(null)}
        protocol={protocol}
        sessionId={sessionIdRef.current}
        currentConfig={currentSessionConfig}
        onConfigApplied={(config, activeDb) => {
          setCurrentSessionConfig(config);
          if (activeDb) setDatabaseName(activeDb);
          setConfigAnchorEl(null);
          // Refresh schema browser if open since database/schema may have changed
          if (schemaBrowserOpen) handleRefreshSchema();
        }}
      />

      {/* Save query dialog */}
      <Dialog
        open={saveDialogOpen}
        onClose={() => setSaveDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Save Query</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Query name"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSaveQuery(); } }}
            sx={{ mt: 1 }}
          />
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              mt: 1,
              display: 'block',
              fontFamily: 'monospace',
              fontSize: '0.7rem',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {activeTab.sql.replace(/\s+/g, ' ').trim().slice(0, 120)}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveQuery} disabled={!saveName.trim()}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
