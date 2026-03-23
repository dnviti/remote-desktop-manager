import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Box,
  CircularProgress,
  Typography,
  Alert,
  IconButton,
  Tooltip,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
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
} from '@mui/icons-material';
import api from '../../api/client';
import type { CredentialOverride } from '../../store/tabsStore';
import type { DbQueryResult, DbTableInfo } from '../../api/database.api';
import { createDbSession, endDbSession, dbSessionHeartbeat } from '../../api/database.api';
import { extractApiError } from '../../utils/apiError';
import { useUiPreferencesStore } from '../../store/uiPreferencesStore';
import DockedToolbar, { ToolbarAction } from '../shared/DockedToolbar';
import DbConnectionStatus, { DbConnectionState } from './DbConnectionStatus';
import DbResultsTable from './DbResultsTable';
import DbSchemaBrowser from './DbSchemaBrowser';
import QueryVisualizer from './QueryVisualizer';
import DbQueryHistory, { addSavedQuery, deriveQueryLabel } from './DbQueryHistory';

interface DbEditorProps {
  connectionId: string;
  tabId: string;
  isActive?: boolean;
  credentials?: CredentialOverride;
}

function classifyQueryType(sql: string): string {
  const t = sql.trim().replace(/^(--[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*/g, '').trim();
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
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const sessionIdRef = useRef<string | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [connectionState, setConnectionState] = useState<DbConnectionState>('connecting');
  const [error, setError] = useState('');
  const [protocol, setProtocol] = useState('postgresql');
  const [databaseName, setDatabaseName] = useState<string | undefined>();
  const [sqlValue, setSqlValue] = useState('');
  const [queryResult, setQueryResult] = useState<DbQueryResult | null>(null);
  const [executing, setExecuting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [schemaTables, setSchemaTables] = useState<DbTableInfo[]>([]);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [visualizerOpen, setVisualizerOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState('');

  const schemaBrowserOpen = useUiPreferencesStore((s) => s.dbSchemaBrowserOpen);
  const historyOpen = useUiPreferencesStore((s) => s.dbQueryHistoryOpen);
  const setPref = useUiPreferencesStore((s) => s.set);

  const [historyRefresh, setHistoryRefresh] = useState(0);

  // Connect to database session on mount
  useEffect(() => {
    let mounted = true;

    async function connect() {
      try {
        const result = await createDbSession({
          connectionId,
          ...(credentials && {
            username: credentials.username,
            password: credentials.password,
          }),
        });

        if (!mounted) {
          // Component unmounted during connection — clean up
          if (result.sessionId) {
            endDbSession(result.sessionId).catch(() => {});
          }
          return;
        }

        sessionIdRef.current = result.sessionId;
        setProtocol(result.protocol);
        setDatabaseName(result.databaseName);
        setConnectionState('connected');

        // Start heartbeat
        heartbeatRef.current = setInterval(() => {
          if (sessionIdRef.current) {
            dbSessionHeartbeat(sessionIdRef.current).catch((err) => {
              if (err?.response?.status === 410) {
                setConnectionState('error');
                setError('Session expired due to inactivity.');
                if (heartbeatRef.current) {
                  clearInterval(heartbeatRef.current);
                  heartbeatRef.current = null;
                }
              }
            });
          }
        }, 15_000);
      } catch (err) {
        if (!mounted) return;
        setConnectionState('error');
        setError(extractApiError(err, 'Failed to connect to database'));
      }
    }

    connect();

    return () => {
      mounted = false;
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      if (sessionIdRef.current) {
        endDbSession(sessionIdRef.current).catch(() => {});
        sessionIdRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  // Execute query
  const handleRunQuery = useCallback(async () => {
    if (!sessionIdRef.current || !sqlValue.trim() || executing) return;

    setExecuting(true);
    setQueryResult(null);

    try {
      const result = await api.post(`/sessions/database/${sessionIdRef.current}/query`, {
        sql: sqlValue.trim(),
      });
      setQueryResult(result.data as DbQueryResult);
      // Trigger history panel refresh
      setHistoryRefresh((n) => n + 1);
    } catch (err) {
      setQueryResult({
        columns: [],
        rows: [],
        rowCount: 0,
        durationMs: 0,
        truncated: false,
      });
      setError(extractApiError(err, 'Query execution failed'));
    } finally {
      setExecuting(false);
    }
  }, [sqlValue, executing]);

  // Refresh schema
  const handleRefreshSchema = useCallback(async () => {
    if (!sessionIdRef.current) return;
    setSchemaLoading(true);
    try {
      const res = await api.get(`/sessions/database/${sessionIdRef.current}/schema`);
      setSchemaTables(res.data.tables ?? []);
    } catch {
      // Schema fetch is best-effort
    } finally {
      setSchemaLoading(false);
    }
  }, []);

  // Handle table click from schema browser — insert SELECT query
  const handleTableClick = useCallback((tableName: string, schemaName: string) => {
    const qualifiedName = schemaName === 'public' ? tableName : `${schemaName}.${tableName}`;
    const limit = protocol === 'oracle' ? 'FETCH FIRST 100 ROWS ONLY'
      : protocol === 'mssql' ? '-- use SELECT TOP 100'
      : 'LIMIT 100';
    setSqlValue((prev) => {
      if (prev.trim()) return prev;
      return protocol === 'mssql'
        ? `SELECT TOP 100 * FROM ${qualifiedName};`
        : `SELECT * FROM ${qualifiedName}\n${limit};`;
    });
  }, [protocol]);

  // Handle generated SQL from schema browser context menu
  const handleInsertSql = useCallback((sql: string) => {
    setSqlValue((prev) => prev.trim() ? `${prev}\n${sql}` : sql);
  }, []);

  const openSaveDialog = useCallback(() => {
    if (!sqlValue.trim()) return;
    setSaveName(deriveQueryLabel(sqlValue));
    setSaveDialogOpen(true);
  }, [sqlValue]);

  const handleSaveQuery = useCallback(() => {
    if (!saveName.trim() || !sqlValue.trim()) return;
    addSavedQuery(connectionId, saveName.trim(), sqlValue.trim());
    setSaveDialogOpen(false);
    setSaveName('');
    setHistoryRefresh((n) => n + 1);
  }, [saveName, sqlValue, connectionId]);

  // Keyboard shortcut: Ctrl+Enter or F5 to run, Ctrl+S to save
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey && e.key === 'Enter') || e.key === 'F5') {
        e.preventDefault();
        handleRunQuery();
      }
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        openSaveDialog();
      }
    },
    [handleRunQuery, openSaveDialog],
  );

  // Format SQL (basic)
  const handleFormatSql = useCallback(() => {
    setSqlValue((prev) => {
      // Basic formatting: uppercase keywords
      const keywords = [
        'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'ORDER BY', 'GROUP BY',
        'HAVING', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'OUTER JOIN',
        'ON', 'AS', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM',
        'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'LIMIT', 'OFFSET',
        'DISTINCT', 'UNION', 'EXCEPT', 'INTERSECT', 'IN', 'NOT', 'NULL',
        'IS', 'LIKE', 'BETWEEN', 'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
      ];
      let formatted = prev;
      for (const kw of keywords) {
        // eslint-disable-next-line security/detect-non-literal-regexp
        const regex = new RegExp(`\\b${kw.replace(/ /g, '\\s+')}\\b`, 'gi');
        formatted = formatted.replace(regex, kw);
      }
      return formatted;
    });
  }, []);

  // Export results as CSV
  const handleExportCsv = useCallback(() => {
    if (!queryResult || queryResult.columns.length === 0) return;

    const header = queryResult.columns.join(',');
    const rows = queryResult.rows.map((row) =>
      queryResult.columns
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
  }, [queryResult]);

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
      icon: executing ? <StopIcon /> : <RunIcon />,
      tooltip: executing ? 'Cancel query' : 'Run query (Ctrl+Enter)',
      onClick: handleRunQuery,
      active: executing,
      disabled: connectionState !== 'connected' || !sqlValue.trim(),
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
      disabled: !sqlValue.trim(),
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
      disabled: !queryResult || queryResult.columns.length === 0,
    },
    {
      id: 'query-visualizer',
      icon: <VisualizerIcon />,
      tooltip: 'Query visualizer',
      onClick: () => setVisualizerOpen(true),
      disabled: !queryResult || !sqlValue.trim(),
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
        />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Tooltip title="Run query (Ctrl+Enter)">
            <span>
              <IconButton
                size="small"
                onClick={handleRunQuery}
                disabled={connectionState !== 'connected' || !sqlValue.trim() || executing}
                color="primary"
              >
                {executing ? <CircularProgress size={16} /> : <RunIcon sx={{ fontSize: 18 }} />}
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Box>

      {/* Connecting overlay */}
      {connectionState === 'connecting' && (
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

      {/* Error alert */}
      {connectionState === 'error' && (
        <Alert severity="error" sx={{ m: 1 }}>
          {error}
        </Alert>
      )}

      {/* Main content area */}
      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden', minWidth: 0, minHeight: 0 }}>
        {/* Editor + Results */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          {/* SQL editor area */}
          <Box
            sx={{
              minHeight: 120,
              maxHeight: '40%',
              display: 'flex',
              flexDirection: 'column',
              borderBottom: 1,
              borderColor: 'divider',
            }}
          >
            <Box
              component="textarea"
              ref={editorRef}
              value={sqlValue}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setSqlValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter SQL query here... (Ctrl+Enter to execute)"
              spellCheck={false}
              sx={{
                flex: 1,
                width: '100%',
                p: 1.5,
                border: 'none',
                outline: 'none',
                resize: 'vertical',
                fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
                fontSize: '0.875rem',
                lineHeight: 1.5,
                bgcolor: 'background.default',
                color: 'text.primary',
                minHeight: 100,
                '&::placeholder': {
                  color: 'text.disabled',
                },
              }}
            />
          </Box>

          <Divider />

          {/* Results area */}
          <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {executing && (
              <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={16} />
                <Typography variant="body2" color="text.secondary">
                  Executing query...
                </Typography>
              </Box>
            )}

            {!executing && queryResult && (
              <DbResultsTable
                columns={queryResult.columns}
                rows={queryResult.rows}
                rowCount={queryResult.rowCount}
                durationMs={queryResult.durationMs}
                truncated={queryResult.truncated}
              />
            )}

            {!executing && !queryResult && connectionState === 'connected' && (
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
          tables={schemaTables}
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
          onSelectQuery={(sql) => setSqlValue(sql)}
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
        queryText={sqlValue}
        queryType={classifyQueryType(sqlValue)}
        executionTimeMs={queryResult?.durationMs ?? null}
        rowsAffected={queryResult?.rowCount ?? null}
        tablesAccessed={[]}
        blocked={false}
        sessionId={sessionIdRef.current ?? undefined}
        dbProtocol={protocol}
        onApplySql={(optimizedSql) => {
          setSqlValue(optimizedSql);
          setVisualizerOpen(false);
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
            {sqlValue.replace(/\s+/g, ' ').trim().slice(0, 120)}
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
