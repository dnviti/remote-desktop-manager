import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Play, Square, Database, Maximize, Minimize, Code, Power, Download,
  Sparkles, GitBranch, History, Save, Plus, X, RefreshCw, SlidersHorizontal,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import Editor, { type OnMount, type Monaco } from '@monaco-editor/react';
import type * as monacoNs from 'monaco-editor';
import { ensureLocalMonacoLoader } from '../../lib/monacoLoader';
import type { CredentialOverride } from '../../store/tabsStore';
import type { DbSettings } from '../../api/connections.api';
import type { DbSchemaInfo, DbSessionConfig } from '../../api/database.api';
import {
  executeDbQuery,
  fetchDbSchema,
} from '../../api/database.api';
import { extractApiError } from '../../utils/apiError';
import { analyzeQuery, confirmGeneration, type ObjectRequest } from '../../api/aiQuery.api';
import { useUiPreferencesStore } from '../../store/uiPreferencesStore';
import ReconnectOverlay from '../shared/ReconnectOverlay';
import { useThemeStore } from '../../store/themeStore';
import DockedToolbar, { ToolbarAction } from '../shared/DockedToolbar';
import DbConnectionStatus from './DbConnectionStatus';
import DbResultsTable from './DbResultsTable';
import DbSchemaBrowser from './DbSchemaBrowser';
import QueryVisualizer from './QueryVisualizer';
import DbQueryHistory from './DbQueryHistory';
import { addSavedQuery, deriveQueryLabel } from './dbQueryHistoryUtils';
import DbSessionConfigPopover from './DbSessionConfigPopover';
import { buildLimitedSelectSql, buildMongoCollectionQuery, qualifyDbObjectName } from './dbBrowserHelpers';
import {
  activeQueryTabIdForTabs,
  classifyQueryType,
  createQuerySubTab,
  hasSessionConfigValues,
  persistableQuerySubTabs,
  restoreQuerySubTabs,
  resultToCsv,
  type QuerySubTab,
} from './dbWorkspaceBehavior';
import { format as formatSql } from 'sql-formatter';
import { createSqlCompletionProvider } from './sqlCompletionProvider';
import { validateSql } from './sqlValidation';
import { useDatabaseSessionController } from './useDatabaseSessionController';
import DbAiAssistantPanel, { type DbAiResult, type DbAiStep } from './DbAiAssistantPanel';

ensureLocalMonacoLoader();

interface DbEditorProps {
  connectionId: string;
  tabId: string;
  isActive?: boolean;
  credentials?: CredentialOverride;
  initialProtocol?: string;
  dbSettings?: DbSettings | null;
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
  dbSettings,
}: DbEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const monacoEditorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const completionDisposableRef = useRef<monacoNs.IDisposable | null>(null);
  const formattingDisposableRef = useRef<monacoNs.IDisposable | null>(null);
  const validationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const editorPaneRef = useRef<HTMLDivElement>(null);
  const resultsPaneRef = useRef<HTMLDivElement>(null);
  const handleRunQueryRef = useRef<() => void>(() => {});
  const activeQueryTabIdRef = useRef<string>('');
  const queryTabsRef = useRef<QuerySubTab[]>([]);

  // Store selectors — must be declared before any useState that depends on them
  const storedSubTabs = useUiPreferencesStore((s) => s.dbQuerySubTabs[tabId]);
  const storedSessionConfig = useUiPreferencesStore((s) => s.dbSessionConfigs[tabId]);
  const legacyStoredSubTabs = useUiPreferencesStore((s) => s.dbQuerySubTabs[connectionId]);
  const legacyStoredSessionConfig = useUiPreferencesStore((s) => s.dbSessionConfigs[connectionId]);
  const schemaBrowserOpen = useUiPreferencesStore((s) => s.dbSchemaBrowserOpen);
  const historyOpen = useUiPreferencesStore((s) => s.dbQueryHistoryOpen);
  const setPref = useUiPreferencesStore((s) => s.set);
  const initialStoredSubTabs = storedSubTabs ?? legacyStoredSubTabs;
  const initialStoredSessionConfig = storedSessionConfig ?? legacyStoredSessionConfig;

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [schemaData, setSchemaData] = useState<DbSchemaInfo>({ tables: [] });
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [visualizerOpen, setVisualizerOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [configAnchorEl, setConfigAnchorEl] = useState<HTMLElement | null>(null);
  const [currentSessionConfig, setCurrentSessionConfig] = useState<DbSessionConfig>(
    () => initialStoredSessionConfig ?? {},
  );
  const {
    connectionState,
    error,
    protocol,
    databaseName,
    sessionId,
    reconnectState,
    reconnectAttempt,
    reconnectMaxRetries,
    triggerReconnect,
    setDatabaseName,
    disconnectSession,
    handleRecoverableSessionError,
    reportOperationError,
    retryNow,
  } = useDatabaseSessionController({
    connectionId,
    credentials,
    currentSessionConfig,
    initialProtocol,
    onSessionConfigChange: setCurrentSessionConfig,
  });

  // AI Assistant state (AISQL-2069)
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiStep, setAiStep] = useState<DbAiStep>('idle');
  const [aiResult, setAiResult] = useState<DbAiResult | null>(null);
  const [aiError, setAiError] = useState('');
  const [showExplanation, setShowExplanation] = useState(false);
  const [aiObjectRequests, setAiObjectRequests] = useState<ObjectRequest[]>([]);
  const [aiApprovals, setAiApprovals] = useState<Record<number, boolean>>({});
  const [aiConversationId, setAiConversationId] = useState('');
  const aiPanelOpen = useUiPreferencesStore((s) => s.dbAiPanelOpen);
  const aiGenerationAvailable = dbSettings?.aiQueryGenerationEnabled !== false;

  const [queryTabs, setQueryTabs] = useState<QuerySubTab[]>(() => restoreQuerySubTabs(initialStoredSubTabs));
  const [activeQueryTabId, setActiveQueryTabId] = useState(() => (
    activeQueryTabIdForTabs(queryTabs, initialStoredSubTabs)
  ));

  const sqlEditorTheme = useUiPreferencesStore((s) => s.sqlEditorTheme);
  const sqlEditorFontSize = useUiPreferencesStore((s) => s.sqlEditorFontSize);
  const sqlEditorFontFamily = useUiPreferencesStore((s) => s.sqlEditorFontFamily);
  const sqlEditorMinimap = useUiPreferencesStore((s) => s.sqlEditorMinimap);
  const themeMode = useThemeStore((s) => s.mode);

  const [historyRefresh, setHistoryRefresh] = useState(0);

  useEffect(() => {
    if (storedSubTabs || !legacyStoredSubTabs) return;
    setPref('dbQuerySubTabs', {
      ...useUiPreferencesStore.getState().dbQuerySubTabs,
      [tabId]: legacyStoredSubTabs,
    });
  }, [legacyStoredSubTabs, setPref, storedSubTabs, tabId]);

  useEffect(() => {
    if (storedSessionConfig || !legacyStoredSessionConfig) return;
    setPref('dbSessionConfigs', {
      ...useUiPreferencesStore.getState().dbSessionConfigs,
      [tabId]: legacyStoredSessionConfig,
    });
  }, [legacyStoredSessionConfig, setPref, storedSessionConfig, tabId]);

  // Persist query sub-tabs to store (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      setPref('dbQuerySubTabs', {
        ...useUiPreferencesStore.getState().dbQuerySubTabs,
        [tabId]: persistableQuerySubTabs(queryTabs, activeQueryTabId),
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [queryTabs, activeQueryTabId, setPref, tabId]);

  // Persist session config to store
  useEffect(() => {
    const prev = useUiPreferencesStore.getState().dbSessionConfigs;
    if (hasSessionConfigValues(currentSessionConfig)) {
      setPref('dbSessionConfigs', { ...prev, [tabId]: currentSessionConfig });
    } else {
      const { [tabId]: _, ...rest } = prev;
      void _;
      setPref('dbSessionConfigs', rest);
    }
  }, [currentSessionConfig, setPref, tabId]);

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

  // Execute query — reads from refs to avoid stale closures in Monaco keybinding
  const handleRunQuery = useCallback(async () => {
    const currentTabs = queryTabsRef.current;
    const currentActiveId = activeQueryTabIdRef.current;
    const tab = currentTabs.find((t) => t.id === currentActiveId);
    if (!sessionId || !tab?.sql.trim() || tab.executing) return;
    const capturedTabId = tab.id;
    updateTab(capturedTabId, { executing: true, result: null });
    try {
      const result = await executeDbQuery(sessionId, tab.sql.trim());
      updateTab(capturedTabId, { result, executing: false });
      // Trigger history panel refresh
      setHistoryRefresh((n) => n + 1);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      handleRecoverableSessionError(status);
      updateTab(capturedTabId, {
        result: { columns: [], rows: [], rowCount: 0, durationMs: 0, truncated: false },
        executing: false,
      });
      reportOperationError(err, 'Query execution failed');
    }
  }, [handleRecoverableSessionError, reportOperationError, sessionId, updateTab]);

  // Keep ref in sync so Monaco keybinding always calls the latest handleRunQuery
  handleRunQueryRef.current = handleRunQuery;

  // Refresh schema
  const handleRefreshSchema = useCallback(async () => {
    if (!sessionId) return;
    setSchemaLoading(true);
    try {
      const schema = await fetchDbSchema(sessionId);
      setSchemaData(schema);
    } catch {
      // Schema fetch is best-effort
    } finally {
      setSchemaLoading(false);
    }
  }, [sessionId]);

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

    const csv = resultToCsv(qr);
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
    await disconnectSession();
  }, [disconnectSession]);

  // AI: Step 1 — analyze prompt and get table permissions
  const handleAiGenerate = useCallback(async () => {
    if (!sessionId || !aiPrompt.trim() || aiStep === 'analyzing' || aiStep === 'generating') return;
    setAiStep('analyzing');
    setAiError('');
    setAiResult(null);
    setAiObjectRequests([]);
    setAiApprovals({});
    setAiConversationId('');
    try {
      const result = await analyzeQuery(sessionId, aiPrompt.trim(), protocol);
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
  }, [aiPrompt, aiStep, protocol, sessionId]);

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
    ...(aiGenerationAvailable ? [{
      id: 'ai-assistant',
      icon: <Sparkles />,
      tooltip: aiPanelOpen ? 'Hide AI assistant' : 'Show AI assistant',
      onClick: () => setPref('dbAiPanelOpen', !aiPanelOpen),
      active: aiPanelOpen,
    } satisfies ToolbarAction] : []),
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
      active: !!configAnchorEl || hasSessionConfigValues(currentSessionConfig),
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
          hasSessionConfig={hasSessionConfigValues(currentSessionConfig)}
        />
        <div className="flex items-center gap-1">
          {(connectionState === 'error' || connectionState === 'disconnected') && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-yellow-400"
              title="Reconnect"
              onClick={retryNow}
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
              const newTab = createQuerySubTab();
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
      {aiGenerationAvailable && aiPanelOpen && connectionState === 'connected' && (
        <DbAiAssistantPanel
          prompt={aiPrompt}
          step={aiStep}
          result={aiResult}
          error={aiError}
          objectRequests={aiObjectRequests}
          approvals={aiApprovals}
          showExplanation={showExplanation}
          onPromptChange={setAiPrompt}
          onGenerate={handleAiGenerate}
          onConfirm={handleAiConfirm}
          onCancel={handleAiCancel}
          onDismissError={() => { setAiError(''); setAiStep('idle'); }}
          onToggleApproval={(index, checked) => setAiApprovals((prev) => ({ ...prev, [index]: checked }))}
          onInsert={handleAiInsert}
          onToggleExplanation={() => setShowExplanation((value) => !value)}
        />
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
          sessionId={sessionId}
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
        sessionId={sessionId ?? undefined}
        dbProtocol={protocol}
        aiQueryOptimizerEnabled={dbSettings?.aiQueryOptimizerEnabled !== false}
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
        sessionId={sessionId}
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
