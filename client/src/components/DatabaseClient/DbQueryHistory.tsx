import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box,
  Typography,
  List,
  ListItemButton,
  Chip,
  IconButton,
  Tooltip,
  Divider,
  TextField,
  InputAdornment,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from '@mui/material';
import {
  History as HistoryIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  ChevronLeft as CollapseIcon,
  Timer as TimerIcon,
  Block as BlockIcon,
  Bookmark as BookmarkIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { getQueryHistory, type QueryHistoryEntry } from '../../api/database.api';

// ---------------------------------------------------------------------------
// Saved queries — localStorage persistence
// ---------------------------------------------------------------------------

export interface SavedQuery {
  id: string;
  name: string;
  sql: string;
  savedAt: string;
}

const STORAGE_KEY_PREFIX = 'arsenale-saved-queries-';

function getSavedQueriesKey(connectionId: string): string {
  return `${STORAGE_KEY_PREFIX}${connectionId}`;
}

export function loadSavedQueries(connectionId: string): SavedQuery[] {
  try {
    const raw = localStorage.getItem(getSavedQueriesKey(connectionId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveSavedQueries(connectionId: string, queries: SavedQuery[]): void {
  localStorage.setItem(getSavedQueriesKey(connectionId), JSON.stringify(queries));
}

export function addSavedQuery(connectionId: string, name: string, sql: string): SavedQuery {
  const queries = loadSavedQueries(connectionId);
  const entry: SavedQuery = {
    id: `sq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    sql,
    savedAt: new Date().toISOString(),
  };
  queries.unshift(entry);
  saveSavedQueries(connectionId, queries);
  return entry;
}

export function deleteSavedQuery(connectionId: string, id: string): void {
  const queries = loadSavedQueries(connectionId).filter((q) => q.id !== id);
  saveSavedQueries(connectionId, queries);
}

// ---------------------------------------------------------------------------
// Query label derivation
// ---------------------------------------------------------------------------

/**
 * Derive a short human-readable label from raw SQL.
 * Extracts CTE names, target tables, and join partners.
 */
export function deriveQueryLabel(sql: string): string {
  const trimmed = sql.trim();

  // CTE: WITH name AS (...), name2 AS (...)
  const cteMatch = trimmed.match(/^WITH\s+(\w+)/i);
  if (cteMatch) {
    const cteNames: string[] = [];
    const cteRegex = /\b(\w+)\s+AS\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = cteRegex.exec(trimmed)) !== null) {
      const name = m[1].toLowerCase();
      if (name !== 'with' && name !== 'select' && name !== 'not') {
        cteNames.push(m[1]);
      }
      if (cteNames.length >= 2) break;
    }
    if (cteNames.length > 0) {
      return cteNames.length === 1
        ? `CTE: ${cteNames[0]}`
        : `CTE: ${cteNames[0]}, ${cteNames[1]}...`;
    }
  }

  // INSERT INTO table
  const insertMatch = trimmed.match(/^INSERT\s+INTO\s+(?:["`])?(\w+)/i);
  if (insertMatch) return `INSERT ${insertMatch[1]}`;

  // UPDATE table
  const updateMatch = trimmed.match(/^UPDATE\s+(?:["`])?(\w+)/i);
  if (updateMatch) return `UPDATE ${updateMatch[1]}`;

  // DELETE FROM table
  const deleteMatch = trimmed.match(/^DELETE\s+FROM\s+(?:["`])?(\w+)/i);
  if (deleteMatch) return `DELETE ${deleteMatch[1]}`;

  // CREATE/ALTER/DROP — strip optional IF [NOT] EXISTS before matching object name
  const ddlHead = trimmed.match(/^(CREATE|ALTER|DROP)\s+(\w+)\s+/i);
  if (ddlHead) {
    const rest = trimmed.slice(ddlHead[0].length).replace(/^IF\s+NOT\s+EXISTS\s+/i, '').replace(/^IF\s+EXISTS\s+/i, '');
    const objMatch = rest.match(/^(?:["`])?(\w+)/);
    if (objMatch) return `${ddlHead[1].toUpperCase()} ${ddlHead[2].toUpperCase()} ${objMatch[1]}`;
  }

  // SELECT ... FROM table [JOIN table2]
  const tables: string[] = [];
  const fromMatch = trimmed.match(/\bFROM\s+(?:["`])?(\w+)/i);
  if (fromMatch) tables.push(fromMatch[1]);

  const joinRegex = /\bJOIN\s+(?:["`])?(\w+)/gi;
  let jm: RegExpExecArray | null;
  while ((jm = joinRegex.exec(trimmed)) !== null) {
    if (!tables.includes(jm[1])) tables.push(jm[1]);
    if (tables.length >= 3) break;
  }

  if (tables.length > 0) {
    const label = tables.slice(0, 2).join(' + ');
    return tables.length > 2 ? `${label} +${tables.length - 2}` : label;
  }

  // Fallback: first meaningful tokens
  const firstLine = trimmed.split('\n')[0].trim();
  return firstLine.length > 40 ? firstLine.slice(0, 37) + '...' : firstLine;
}

// ---------------------------------------------------------------------------
// Props & helpers
// ---------------------------------------------------------------------------

interface DbQueryHistoryProps {
  open: boolean;
  onClose: () => void;
  sessionId: string | null;
  connectionId: string;
  onSelectQuery: (sql: string) => void;
  refreshTrigger?: number;
  onSaveRequest?: () => void;
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const TYPE_COLORS: Record<string, 'primary' | 'success' | 'warning' | 'error' | 'info' | 'default'> = {
  SELECT: 'info',
  INSERT: 'success',
  UPDATE: 'warning',
  DELETE: 'error',
  DDL: 'primary',
  OTHER: 'default',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DbQueryHistory({
  open,
  onClose,
  sessionId,
  connectionId,
  onSelectQuery,
  refreshTrigger = 0,
}: DbQueryHistoryProps) {
  const [entries, setEntries] = useState<QueryHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const reloadSaved = useCallback(() => {
    if (connectionId) setSavedQueries(loadSavedQueries(connectionId));
  }, [connectionId]);

  const fetchHistory = useCallback(async (searchTerm?: string) => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const result = await getQueryHistory(sessionId, 100, searchTerm || undefined);
      setEntries(result);
    } catch {
      // Silently ignore — history is best-effort
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  // Fetch on open, search change, or refresh trigger
  useEffect(() => {
    if (open && sessionId) {
      fetchHistory(searchDebounced);
      reloadSaved();
    }
  }, [open, sessionId, searchDebounced, fetchHistory, refreshTrigger, reloadSaved]);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setSearchDebounced(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Filter saved queries by search
  const filteredSaved = useMemo(() => {
    if (!search) return savedQueries;
    const term = search.toLowerCase();
    return savedQueries.filter(
      (q) => q.name.toLowerCase().includes(term) || q.sql.toLowerCase().includes(term),
    );
  }, [savedQueries, search]);

  const handleDeleteSaved = useCallback((id: string) => {
    deleteSavedQuery(connectionId, id);
    reloadSaved();
    setDeleteConfirm(null);
  }, [connectionId, reloadSaved]);

  if (!open) return null;

  return (
    <Box
      sx={{
        width: 320,
        borderLeft: 1,
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        bgcolor: 'background.paper',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          px: 1.5,
          py: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <HistoryIcon fontSize="small" color="primary" />
        <Typography variant="subtitle2" sx={{ flex: 1 }}>Query History</Typography>
        <Tooltip title="Refresh">
          <IconButton size="small" onClick={() => fetchHistory(searchDebounced)} disabled={loading}>
            {loading ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Close">
          <IconButton size="small" onClick={onClose}>
            <CollapseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Search */}
      <Box sx={{ px: 1.5, py: 1 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Search queries..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
          sx={{ '& .MuiInputBase-root': { height: 32, fontSize: '0.8rem' } }}
        />
      </Box>

      <Divider />

      {/* Saved queries section */}
      {filteredSaved.length > 0 && (
        <>
          <Box sx={{ px: 1.5, py: 0.5 }}>
            <Typography variant="caption" fontWeight={700} color="primary.main">
              Saved
            </Typography>
          </Box>
          <List dense disablePadding>
            {filteredSaved.map((sq) => (
              <ListItemButton
                key={sq.id}
                onClick={() => onSelectQuery(sq.sql)}
                sx={{
                  py: 0.75,
                  px: 1.5,
                  borderBottom: 1,
                  borderColor: 'divider',
                  gap: 1,
                }}
              >
                <BookmarkIcon sx={{ fontSize: 16, color: 'primary.main', flexShrink: 0 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography
                    variant="body2"
                    fontWeight={600}
                    sx={{ fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {sq.name}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{
                      fontFamily: 'monospace',
                      fontSize: '0.7rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      display: 'block',
                    }}
                  >
                    {sq.sql.replace(/\s+/g, ' ').trim()}
                  </Typography>
                </Box>
                <Tooltip title="Remove">
                  <IconButton
                    size="small"
                    onClick={(e) => { e.stopPropagation(); setDeleteConfirm(sq.id); }}
                    sx={{ p: 0.25, opacity: 0.5, '&:hover': { opacity: 1 } }}
                  >
                    <DeleteIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Tooltip>
              </ListItemButton>
            ))}
          </List>
          <Divider />
        </>
      )}

      {/* Recent queries section */}
      {(entries.length > 0 || filteredSaved.length > 0) && (
        <Box sx={{ px: 1.5, py: 0.5 }}>
          <Typography variant="caption" fontWeight={700} color="text.secondary">
            Recent
          </Typography>
        </Box>
      )}

      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {entries.length === 0 && filteredSaved.length === 0 && !loading && (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              {search ? 'No matching queries' : 'No query history yet'}
            </Typography>
            <Typography variant="caption" color="text.disabled" sx={{ mt: 0.5, display: 'block' }}>
              Press Ctrl+S to save a query
            </Typography>
          </Box>
        )}

        <List dense disablePadding>
          {entries.map((entry) => {
            const label = deriveQueryLabel(entry.queryText);
            return (
              <ListItemButton
                key={entry.id}
                onClick={() => onSelectQuery(entry.queryText)}
                sx={{
                  py: 0.75,
                  px: 1.5,
                  borderBottom: 1,
                  borderColor: 'divider',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 0.25,
                  minHeight: 52,
                  maxHeight: 72,
                }}
              >
                {/* Row 1: type chip + label + timestamp */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, width: '100%' }}>
                  <Chip
                    label={entry.queryType}
                    size="small"
                    color={TYPE_COLORS[entry.queryType] ?? 'default'}
                    sx={{ height: 18, fontSize: '0.65rem', fontWeight: 700 }}
                  />
                  {entry.blocked && (
                    <BlockIcon sx={{ fontSize: 14, color: 'error.main' }} />
                  )}
                  <Typography
                    variant="body2"
                    fontWeight={600}
                    sx={{
                      flex: 1,
                      fontSize: '0.78rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {label}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ flexShrink: 0, fontSize: '0.65rem' }}
                  >
                    {formatRelativeTime(entry.createdAt)}
                  </Typography>
                </Box>

                {/* Row 2: single-line SQL preview */}
                <Typography
                  variant="caption"
                  sx={{
                    fontFamily: 'monospace',
                    fontSize: '0.7rem',
                    color: 'text.secondary',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    width: '100%',
                  }}
                >
                  {entry.queryText.replace(/\s+/g, ' ').trim()}
                </Typography>

                {/* Row 3: metrics */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {entry.executionTimeMs != null && (
                    <Typography
                      variant="caption"
                      color="text.disabled"
                      sx={{ display: 'flex', alignItems: 'center', gap: 0.3, fontSize: '0.65rem' }}
                    >
                      <TimerIcon sx={{ fontSize: 11 }} />
                      {entry.executionTimeMs}ms
                    </Typography>
                  )}
                  {entry.rowsAffected != null && (
                    <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem' }}>
                      {entry.rowsAffected} rows
                    </Typography>
                  )}
                </Box>
              </ListItemButton>
            );
          })}
        </List>
      </Box>

      {/* Delete confirmation */}
      <Dialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} maxWidth="xs">
        <DialogTitle>Remove saved query?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">This will remove the query from your saved list.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          <Button color="error" onClick={() => deleteConfirm && handleDeleteSaved(deleteConfirm)}>
            Remove
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
