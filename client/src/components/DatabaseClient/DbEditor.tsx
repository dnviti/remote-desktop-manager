import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Play, Square, Database, Maximize, Minimize, Code, Power, Download,
  Sparkles, GitBranch, History, Save, Plus, X, RefreshCw, SlidersHorizontal,
  Shield, Send, Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import Editor, { type OnMount, type Monaco } from '@monaco-editor/react';
import type * as monacoNs from 'monaco-editor';
import api from '../../api/client';
import { ensureLocalMonacoLoader } from '../../lib/monacoLoader';
import type { CredentialOverride } from '../../store/tabsStore';
import type { DbQueryResult, DbSchemaInfo, DbSessionConfig } from '../../api/database.api';
import { createDbSession, endDbSession, dbSessionHeartbeat, updateDbSessionConfig } from '../../api/database.api';
import { extractApiError } from '../../utils/apiError';
import { analyzeQuery, confirmGeneration, type ObjectRequest } from '../../api/aiQuery.api';
import { useUiPreferencesStore } from '../../store/uiPreferencesStore';
import { useAutoReconnect } from '../../hooks/useAutoReconnect';
import ReconnectOverlay from '../shared/ReconnectOverlay';
import { useThemeStore } from '../../store/themeStore';
import DockedToolbar, { ToolbarAction } from '../shared/DockedToolbar';
import DbConnectionStatus, { DbConnectionState } from './DbConnectionStatus';
import DbResultsTable from './DbResultsTable';
import DbSchemaBrowser from './DbSchemaBrowser';
import QueryVisualizer from './QueryVisualizer';
import DbQueryHistory from './DbQueryHistory';
import { addSavedQuery, deriveQueryLabel } from './dbQueryHistoryUtils';
import DbSessionConfigPopover from './DbSessionConfigPopover';
import { buildLimitedSelectSql, buildMongoCollectionQuery, qualifyDbObjectName } from './dbBrowserHelpers';
import { format as formatSql } from 'sql-formatter';
import { createSqlCompletionProvider } from './sqlCompletionProvider';
import { validateSql } from './sqlValidation';

ensureLocalMonacoLoader();

interface DbEditorProps {
  connectionId: string;
  tabId: string;
  isActive?: boolean;
  credentials?: CredentialOverride;
  initialProtocol?: string;
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

function defaultSessionConfigForProtocol(protocol: string, databaseName?: string): DbSessionConfig {
  const normalized = protocol.toLowerCase();
  const defaults: DbSessionConfig = {};

  switch (normalized) {
    case 'postgresql':
      defaults.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (databaseName) {
        defaults.activeDatabase = databaseName;
        defaults.searchPath = 'public';
      }
      return defaults;
    case 'mysql':
      defaults.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (databaseName) {
        defaults.activeDatabase = databaseName;
      }
      return defaults;
    case 'mssql':
      if (databaseName) {
        defaults.activeDatabase = databaseName;
      }
      return defaults;
    case 'oracle':
      defaults.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return defaults;
    default:
      return defaults;
  }
}

function formatMongoQuery(raw: string): string {
  const parsed = JSON.parse(raw);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export default function DbEditor({
  connectionId,
  tabId,
  isActive = true,
  credentials,
  initialProtocol,
}: DbEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const monacoEditorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const completionDisposableRef = useRef<monacoNs.IDisposable | null>(null);
  const formattingDisposableRef = useRef<monacoNs.IDisposable | null>(null);
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
  const [protocol, setProtocol] = useState(initialProtocol || 'postgresql');
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

  // AI Assistant state (AISQL-2069)
  type AiStep = 'idle' | 'analyzing' | 'permissions' | 'generating' | 'result' | 'error';
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiStep, setAiStep] = useState<AiStep>('idle');
  const [aiResult, setAiResult] = useState<{ sql: string; explanation: string; firewallWarning?: string } | null>(null);
  const [aiError, setAiError] = useState('');
  const [showExplanation, setShowExplanation] = useState(false);
  const [aiObjectRequests, setAiObjectRequests] = useState<ObjectRequest[]>([]);
  const [aiApprovals, setAiApprovals] = useState<Record<number, boolean>>({});
  const [aiConversationId, setAiConversationId] = useState('');
  const aiPanelOpen = useUiPreferencesStore((s) => s.dbAiPanelOpen);

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
    if (Object.keys(currentSessionConfig).length === 0) {
      const defaults = defaultSessionConfigForProtocol(result.protocol, result.databaseName);
      if (Object.keys(defaults).length > 0) {
        setCurrentSessionConfig(defaults);
        // Apply defaults to the live session
        updateDbSessionConfig(result.sessionId, defaults).catch(() => {});
      }
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
  }, [connectionId, credentials, currentSessionConfig]); // eslint-disable-line react-hooks/exhaustive-deps

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
    editor.addAction({
      id: 'run-sql-query',
      label: 'Run Query',
      keybindings: [
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
      ],
      run: () => { handleRunQueryRef.current(); },
    });

    // Register F5 keybinding for query execution
    editor.addAction({
      id: 'run-sql-query-f5',
      label: 'Run Query (F5)',
      keybindings: [
        monaco.KeyCode.F5,
      ],
      run: () => { handleRunQueryRef.current(); },
    });

    // Register SQL formatting provider (sql-formatter)
    formattingDisposableRef.current = monaco.languages.registerDocumentFormattingEditProvider(
      'sql',
      {
        provideDocumentFormattingEdits(model: monacoNs.editor.ITextModel) {
          const text = model.getValue();
          const formatted = formatSql(text, { language: 'sql', tabWidth: 2, keywordCase: 'upper' });
          return [{ range: model.getFullModelRange(), text: formatted }];
        },
      },
    );

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

    if (protocol === 'mongodb') {
      return;
    }

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
  }, [protocol, updateTab]);

  // Cleanup validation timer and completion provider on unmount
  useEffect(() => {
    return () => {
      if (validationTimerRef.current) clearTimeout(validationTimerRef.current);
      completionDisposableRef.current?.dispose();
      formattingDisposableRef.current?.dispose();
    };
  }, []);

  // Handle table click from schema browser — insert SELECT query
  const handleTableClick = useCallback((tableName: string, schemaName: string) => {
    if (protocol === 'mongodb') {
      updateTab(activeQueryTabId, {
        sql: activeTab.sql.trim() ? activeTab.sql : buildMongoCollectionQuery(tableName, databaseName ?? schemaName),
      });
      return;
    }

    const qualifiedName = qualifyDbObjectName(protocol, schemaName, tableName);
    updateTab(activeQueryTabId, {
      sql: activeTab.sql.trim()
        ? activeTab.sql
        : buildLimitedSelectSql(protocol, '*', qualifiedName),
    });
  }, [protocol, databaseName, activeQueryTabId, activeTab, updateTab]);

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

  // Format SQL using sql-formatter (toolbar button or Monaco Shift+Alt+F)
  const handleFormatSql = useCallback(() => {
    if (protocol === 'mongodb') {
      try {
        updateTab(activeQueryTabId, { sql: formatMongoQuery(activeTab.sql) });
      } catch {
        // Leave invalid JSON unchanged.
      }
      return;
    }

    const editor = monacoEditorRef.current;
    if (editor) {
      // Trigger Monaco's format action — our registered provider will handle it
      const formatAction = editor.getAction('editor.action.formatDocument');
      if (formatAction) {
        formatAction.run();
        return;
      }
    }
    // Fallback: format directly via sql-formatter and update state
    const formatted = formatSql(activeTab.sql, { language: 'sql', tabWidth: 2, keywordCase: 'upper' });
    updateTab(activeQueryTabId, { sql: formatted });
  }, [protocol, activeTab, activeQueryTabId, updateTab]);

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

  // AI: Step 1 — analyze prompt and get table permissions
  const handleAiGenerate = useCallback(async () => {
    if (!sessionIdRef.current || !aiPrompt.trim() || aiStep === 'analyzing' || aiStep === 'generating') return;
    setAiStep('analyzing');
    setAiError('');
    setAiResult(null);
    setAiObjectRequests([]);
    setAiApprovals({});
    setAiConversationId('');
    try {
      const result = await analyzeQuery(sessionIdRef.current, aiPrompt.trim(), protocol);
      setAiConversationId(result.conversationId);
      setAiObjectRequests(result.objectRequests);
      const defaults: Record<number, boolean> = {};
      result.objectRequests.forEach((_, i) => { defaults[i] = false; });
      setAiApprovals(defaults);
      setAiStep('permissions');
    } catch (err) {
      setAiError(extractApiError(err, 'AI query analysis failed'));
      setAiStep('error');
    }
  }, [aiPrompt, aiStep, protocol]);

  // AI: Step 2 — confirm approved tables and generate SQL
  const handleAiConfirm = useCallback(async () => {
    if (!aiConversationId) return;
    const approved = aiObjectRequests
      .filter((_, i) => aiApprovals[i])
      .map((r) => r.schema !== 'public' ? `${r.schema}.${r.name}` : r.name);
    if (approved.length === 0) return;

    setAiStep('generating');
    setAiError('');
    try {
      const result = await confirmGeneration(aiConversationId, approved);
      setAiResult({ sql: result.sql, explanation: result.explanation, firewallWarning: result.firewallWarning });
      setAiStep('result');
    } catch (err) {
      setAiError(extractApiError(err, 'AI query generation failed'));
      setAiStep('error');
    }
  }, [aiConversationId, aiObjectRequests, aiApprovals]);

  // AI: Cancel permissions and go back to idle
  const handleAiCancel = useCallback(() => {
    setAiStep('idle');
    setAiObjectRequests([]);
    setAiApprovals({});
    setAiConversationId('');
    setAiError('');
  }, []);

  // AI: Insert generated SQL into editor
  const handleAiInsert = useCallback(() => {
    if (!aiResult?.sql) return;
    const current = activeTab.sql;
    const newSql = current.trim() ? current + '\n\n' + aiResult.sql : aiResult.sql;
    updateTab(activeQueryTabId, { sql: newSql });
  }, [aiResult, activeTab.sql, activeQueryTabId, updateTab]);

  // Build toolbar actions
  const toolbarActions: ToolbarAction[] = [
    {
      id: 'run-query',
      icon: activeTab.executing ? <Square /> : <Play />,
      tooltip: activeTab.executing ? 'Cancel query' : 'Run query (Ctrl+Enter)',
      onClick: handleRunQuery,
      active: activeTab.executing,
      disabled: connectionState !== 'connected' || !activeTab.sql.trim(),
    },
    {
      id: 'format-sql',
      icon: <Code />,
      tooltip: protocol === 'mongodb' ? 'Format JSON query' : 'Format SQL',
      onClick: handleFormatSql,
      disabled: connectionState !== 'connected',
    },
    {
      id: 'save-query',
      icon: <Save />,
      tooltip: 'Save query (Ctrl+S)',
      onClick: openSaveDialog,
      disabled: !activeTab.sql.trim(),
    },
    {
      id: 'schema-browser',
      icon: <Database />,
      tooltip: schemaBrowserOpen ? 'Hide schema browser' : 'Show schema browser',
      onClick: () => {
        const newVal = !schemaBrowserOpen;
        setPref('dbSchemaBrowserOpen', newVal);
        if (newVal) handleRefreshSchema();
      },
      active: schemaBrowserOpen,
    },
    {
      id: 'ai-assistant',
      icon: <Sparkles />,
      tooltip: aiPanelOpen ? 'Hide AI assistant' : 'Show AI assistant',
      onClick: () => setPref('dbAiPanelOpen', !aiPanelOpen),
      active: aiPanelOpen,
    },
    {
      id: 'query-history',
      icon: <History />,
      tooltip: historyOpen ? 'Hide query history' : 'Show query history',
      onClick: () => setPref('dbQueryHistoryOpen', !historyOpen),
      active: historyOpen,
    },
    {
      id: 'session-settings',
      icon: <SlidersHorizontal />,
      tooltip: 'Session settings',
      onClick: (event) => setConfigAnchorEl(event?.currentTarget ?? null),
      active: !!configAnchorEl || Object.values(currentSessionConfig).some((v) => v !== undefined),
      disabled: connectionState !== 'connected' || protocol === 'mongodb',
    },
    {
      id: 'export-csv',
      icon: <Download />,
      tooltip: 'Export results as CSV',
      onClick: handleExportCsv,
      disabled: !activeTab.result || activeTab.result.columns.length === 0,
    },
    {
      id: 'query-visualizer',
      icon: <GitBranch />,
      tooltip: 'Query visualizer',
      onClick: () => setVisualizerOpen(true),
      disabled: !activeTab.result || !activeTab.sql.trim(),
      active: visualizerOpen,
    },
    {
      id: 'fullscreen',
      icon: isFullscreen ? <Minimize /> : <Maximize />,
      tooltip: isFullscreen ? 'Exit fullscreen' : 'Fullscreen',
      onClick: toggleFullscreen,
    },
    {
      id: 'disconnect',
      icon: <Power />,
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
    <div
      ref={containerRef}
      className="flex flex-1 flex-row relative bg-background min-w-0 overflow-hidden"
    >
      {connectionState === 'connected' && (
        <DockedToolbar actions={toolbarActions} />
      )}
      <div className="flex flex-1 flex-col min-w-0 relative overflow-hidden">
      {/* Status bar */}
      <div className="px-3 py-1 flex items-center justify-between border-b border-border bg-card">
        <DbConnectionStatus
          state={connectionState}
          protocol={protocol}
          databaseName={databaseName}
          error={connectionState === 'error' ? error : undefined}
          hasSessionConfig={Object.values(currentSessionConfig).some((v) => v !== undefined)}
        />
        <div className="flex items-center gap-1">
          {(connectionState === 'error' || connectionState === 'disconnected') && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-yellow-400"
              title="Reconnect"
              onClick={() => {
                resetReconnect();
                connectSession().catch((err) => {
                  if (!mountedRef.current) return;
                  setConnectionState('error');
                  setError(extractApiError(err, 'Reconnection failed'));
                });
              }}
            >
              <RefreshCw className="size-[18px]" />
            </Button>
          )}
        </div>
      </div>

      {/* Query sub-tabs */}
      {connectionState === 'connected' && (
        <div className="flex items-center border-b border-border bg-card min-h-[32px]">
          <div className="flex-1 flex overflow-x-auto">
            {queryTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveQueryTabId(tab.id)}
                className={cn(
                  'flex items-center gap-1 px-3 py-1 text-xs border-b-2 transition-colors whitespace-nowrap',
                  tab.id === activeQueryTabId
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
                )}
              >
                {tab.executing && <Loader2 className="size-2.5 animate-spin" />}
                <span>{tab.label}</span>
                {queryTabs.length > 1 && (
                  <X
                    className="size-3.5 ml-1 opacity-50 hover:opacity-100"
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
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 mx-1"
            title="New query tab"
            onClick={() => {
              const newTab = createSubTab();
              setQueryTabs((prev) => [...prev, newTab]);
              setActiveQueryTabId(newTab.id);
            }}
          >
            <Plus className="size-4" />
          </Button>
        </div>
      )}

      {/* Connecting overlay */}
      {connectionState === 'connecting' && reconnectState === 'idle' && (
        <div className="absolute inset-0 flex items-center justify-center z-10 bg-black/50">
          <Loader2 className="size-5 animate-spin mr-2" />
          <span>Connecting to database...</span>
        </div>
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
        <div className="m-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* AI Assistant panel */}
      {aiPanelOpen && connectionState === 'connected' && (
        <div className="border-b border-border p-3 bg-primary/[0.04]">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="size-[18px] text-primary" />
            <span className="text-sm font-semibold text-primary">
              AI Assistant
            </span>
          </div>

          {/* Prompt input — shown in idle, error, and result steps */}
          {(aiStep === 'idle' || aiStep === 'error' || aiStep === 'result') && (
            <div className="flex gap-2 items-start">
              <textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="Describe the query you need in plain English..."
                className="flex-1 min-h-[40px] max-h-[80px] rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 resize-none"
                rows={1}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleAiGenerate();
                  }
                }}
              />
              <Button
                size="sm"
                onClick={handleAiGenerate}
                disabled={!aiPrompt.trim()}
                className="min-w-[90px] h-10"
              >
                Generate
              </Button>
            </div>
          )}

          {/* Loading: analyzing or generating */}
          {(aiStep === 'analyzing' || aiStep === 'generating') && (
            <div className="flex items-center gap-3 py-4 justify-center">
              <Loader2 className="size-5 animate-spin" />
              <span className="text-sm text-muted-foreground">
                {aiStep === 'analyzing' ? 'Analyzing which tables are needed...' : 'Generating SQL query...'}
              </span>
            </div>
          )}

          {/* Permissions step — table approval cards */}
          {aiStep === 'permissions' && (
            <div className="mt-1">
              <h4 className="text-sm font-semibold mb-1 flex items-center gap-1">
                <Shield className="size-4 text-yellow-400" />
                Tables needed ({Object.values(aiApprovals).filter(Boolean).length}/{aiObjectRequests.length} approved)
              </h4>
              <p className="text-sm text-muted-foreground mb-3">
                The AI identified these tables for your query. Approve which ones it can read:
              </p>

              <div className="flex flex-col gap-2 mb-4">
                {aiObjectRequests.map((req, i) => (
                  <div
                    key={i}
                    className={cn(
                      'rounded-lg border border-border p-3',
                      aiApprovals[i] && 'bg-accent/50',
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="h-5">
                            {req.schema}
                          </Badge>
                          <span className="text-sm font-semibold">{req.name}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">{req.reason}</span>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <span className="text-xs text-muted-foreground">
                          {aiApprovals[i] ? 'Allow' : 'Deny'}
                        </span>
                        <Switch
                          checked={aiApprovals[i] ?? false}
                          onCheckedChange={(checked) => setAiApprovals((prev) => ({ ...prev, [i]: checked }))}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleAiConfirm}
                  disabled={Object.values(aiApprovals).filter(Boolean).length === 0}
                >
                  <Send className="size-4" />
                  Generate with approved ({Object.values(aiApprovals).filter(Boolean).length})
                </Button>
                <Button variant="ghost" size="sm" onClick={handleAiCancel}>Cancel</Button>
              </div>
            </div>
          )}

          {/* Error display */}
          {aiStep === 'error' && aiError && (
            <div className="mt-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400 flex items-center justify-between">
              <span>{aiError}</span>
              <button onClick={() => { setAiError(''); setAiStep('idle'); }} className="text-red-400 hover:text-red-300 ml-2 text-xs">dismiss</button>
            </div>
          )}

          {/* Result display */}
          {aiStep === 'result' && aiResult && (
            <div className="mt-3">
              <div className="p-2 bg-background rounded border border-border font-mono text-[0.8125rem] whitespace-pre-wrap break-words max-h-[150px] overflow-auto">
                {aiResult.sql}
              </div>

              {aiResult.firewallWarning && (
                <div className="mt-2 rounded border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-400">
                  {aiResult.firewallWarning}
                </div>
              )}

              <div className="flex gap-2 mt-2">
                <Button variant="outline" size="sm" onClick={handleAiInsert}>
                  Insert into editor
                </Button>
                {aiResult.explanation && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowExplanation((v) => !v)}
                  >
                    {showExplanation ? 'Hide explanation' : 'Explain'}
                  </Button>
                )}
              </div>

              {showExplanation && aiResult.explanation && (
                <p className="text-sm text-muted-foreground mt-2 pl-2 border-l-2 border-primary">
                  {aiResult.explanation}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden min-w-0 min-h-0">
        {/* Editor + Results (resizable split) */}
        <div ref={splitContainerRef} className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Query editor area */}
          <div
            ref={editorPaneRef}
            style={{ flex: `${splitRatio} 1 0%` }}
            className="min-h-[80px] flex flex-col overflow-hidden"
          >
            <Editor
              language={protocol === 'mongodb' ? 'json' : 'sql'}
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
                placeholder: protocol === 'mongodb'
                  ? 'Enter a MongoDB JSON query spec here... (Ctrl+Enter to execute)'
                  : 'Enter SQL query here... (Ctrl+Enter to execute)',
              }}
              loading={
                <div className="flex items-center justify-center flex-1">
                  <Loader2 className="size-5 animate-spin" />
                </div>
              }
            />
          </div>

          {/* Drag handle */}
          <div
            onMouseDown={handleSplitDragStart}
            className="h-1 cursor-row-resize bg-border shrink-0 hover:bg-primary transition-colors"
          />

          {/* Results area */}
          <div
            ref={resultsPaneRef}
            style={{ flex: `${1 - splitRatio} 1 0%` }}
            className="overflow-hidden flex flex-col min-h-[40px]"
          >
            {activeTab.executing && (
              <div className="p-4 flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                <span className="text-sm text-muted-foreground">
                  Executing query...
                </span>
              </div>
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
              <div className="flex-1 flex items-center justify-center">
                <span className="text-sm text-muted-foreground">
                  {protocol === 'mongodb'
                    ? 'Write a MongoDB JSON query spec and press Ctrl+Enter to execute'
                    : 'Write a SQL query and press Ctrl+Enter to execute'}
                </span>
              </div>
            )}
          </div>
        </div>

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
      </div>

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
      <Dialog open={saveDialogOpen} onOpenChange={(open) => !open && setSaveDialogOpen(false)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Save Query</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Query name"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSaveQuery(); } }}
            className="mt-1"
          />
          <p className="text-xs text-muted-foreground mt-1 font-mono overflow-hidden text-ellipsis whitespace-nowrap">
            {activeTab.sql.replace(/\s+/g, ' ').trim().slice(0, 120)}
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveQuery} disabled={!saveName.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>{/* end inner content column */}
    </div>
  );
}
