import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import {
  Dialog, AppBar, Toolbar, Typography, Box, IconButton, Card, CardContent,
  Table, TableHead, TableBody, TableRow, TableCell, TablePagination,
  Select, MenuItem, FormControl, InputLabel, TextField, Stack,
  CircularProgress, Chip, Alert, Collapse, TableSortLabel, InputAdornment,
  Tooltip, Tabs, Tab,
} from '@mui/material';
import {
  Close as CloseIcon,
  Search as SearchIcon,
  KeyboardArrowDown as ExpandIcon,
  KeyboardArrowUp as CollapseIcon,
  Pause as PauseIcon,
  PlayArrow as PlayArrowIcon,
  Warning as WarningIcon,
  Storage as StorageIcon,
  List as ListIcon,
  Visibility as VisualizeIcon,
} from '@mui/icons-material';
import { getAuditLogs, getAuditGateways, getAuditCountries, AuditLogEntry, AuditAction, AuditLogParams, AuditGateway } from '../../api/audit.api';
import {
  getDbAuditLogs, getDbAuditConnections, getDbAuditUsers,
  DbAuditLogEntry, DbAuditLogParams, DbAuditConnection, DbAuditUser, DbQueryType,
} from '../../api/dbAudit.api';
import { useUiPreferencesStore } from '../../store/uiPreferencesStore';
import { useAuthStore } from '../../store/authStore';
import { ACTION_LABELS, getActionColor, formatDetails, ALL_ACTIONS, TARGET_TYPES } from '../Audit/auditConstants';
import IpGeoCell from '../Audit/IpGeoCell';
import { SlideUp } from '../common/SlideUp';
import QueryVisualizer from '../DatabaseClient/QueryVisualizer';
import RecordingPlayerDialog from '../Recording/RecordingPlayerDialog';
import { getRecording } from '../../api/recordings.api';
import type { Recording } from '../../api/recordings.api';
import { getSessionRecording } from '../../api/audit.api';

interface AuditLogDialogProps {
  open: boolean;
  onClose: () => void;
  onGeoIpClick?: (ip: string) => void;
}

const AUTO_REFRESH_INTERVAL_MS = 10_000;

const QUERY_TYPE_LABELS: Record<DbQueryType, string> = {
  SELECT: 'SELECT',
  INSERT: 'INSERT',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  DDL: 'DDL',
  OTHER: 'Other',
};

const QUERY_TYPE_COLORS: Record<DbQueryType, 'default' | 'primary' | 'secondary' | 'error' | 'warning' | 'success' | 'info'> = {
  SELECT: 'info',
  INSERT: 'success',
  UPDATE: 'primary',
  DELETE: 'error',
  DDL: 'warning',
  OTHER: 'default',
};

const ALL_QUERY_TYPES: DbQueryType[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DDL', 'OTHER'];

export default function AuditLogDialog({ open, onClose, onGeoIpClick }: AuditLogDialogProps) {
  const user = useAuthStore((s) => s.user);
  const hasTenant = Boolean(user?.tenantId);
  const auditLogAction = useUiPreferencesStore((s) => s.auditLogAction);
  const auditLogSearch = useUiPreferencesStore((s) => s.auditLogSearch);
  const auditLogTargetType = useUiPreferencesStore((s) => s.auditLogTargetType);
  const auditLogGatewayId = useUiPreferencesStore((s) => s.auditLogGatewayId);
  const auditLogSortBy = useUiPreferencesStore((s) => s.auditLogSortBy);
  const auditLogSortOrder = useUiPreferencesStore((s) => s.auditLogSortOrder);
  const autoRefreshPaused = useUiPreferencesStore((s) => s.auditLogAutoRefreshPaused);
  const auditLogTab = useUiPreferencesStore((s) => s.auditLogDialogTab);
  const setUiPref = useUiPreferencesStore((s) => s.set);

  // ---- General Audit Log state ----
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [ipAddress, setIpAddress] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(auditLogSearch);
  const [gateways, setGateways] = useState<AuditGateway[]>([]);
  const [countries, setCountries] = useState<string[]>([]);
  const [geoCountry, setGeoCountry] = useState('');
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  // ---- SQL Audit Log state ----
  const [dbLogs, setDbLogs] = useState<DbAuditLogEntry[]>([]);
  const [dbTotal, setDbTotal] = useState(0);
  const [dbPage, setDbPage] = useState(0);
  const [dbRowsPerPage, setDbRowsPerPage] = useState(25);
  const [dbLoading, setDbLoading] = useState(false);
  const [dbError, setDbError] = useState('');
  const [dbSearch, setDbSearch] = useState('');
  const [dbQueryType, setDbQueryType] = useState('');
  const [dbConnectionId, setDbConnectionId] = useState('');
  const [dbUserId, setDbUserId] = useState('');
  const [dbBlocked, setDbBlocked] = useState('');
  const [dbStartDate, setDbStartDate] = useState('');
  const [dbEndDate, setDbEndDate] = useState('');
  const [dbExpandedRowId, setDbExpandedRowId] = useState<string | null>(null);
  const [dbConnections, setDbConnections] = useState<DbAuditConnection[]>([]);
  const [dbUsers, setDbUsers] = useState<DbAuditUser[]>([]);

  // ---- Query Visualizer state ----
  const [visualizerEntry, setVisualizerEntry] = useState<DbAuditLogEntry | null>(null);

  // ---- Recording Player state ----
  const [selectedRecording, setSelectedRecording] = useState<Recording | null>(null);
  const [recordingPlayerOpen, setRecordingPlayerOpen] = useState(false);
  const [loadingRecordingId, setLoadingRecordingId] = useState<string | null>(null);

  const activeTab = auditLogTab || 'general';

  // Debounce search input -> store
  useEffect(() => {
    const timer = setTimeout(() => {
      setUiPref('auditLogSearch', searchInput);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, setUiPref]);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: AuditLogParams = {
        page: page + 1,
        limit: rowsPerPage,
        sortBy: auditLogSortBy as 'createdAt' | 'action',
        sortOrder: auditLogSortOrder as 'asc' | 'desc',
      };
      if (auditLogAction) params.action = auditLogAction as AuditAction;
      if (auditLogSearch) params.search = auditLogSearch;
      if (auditLogTargetType) params.targetType = auditLogTargetType;
      if (auditLogGatewayId) params.gatewayId = auditLogGatewayId;
      if (ipAddress) params.ipAddress = ipAddress;
      if (geoCountry) params.geoCountry = geoCountry;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      if (flaggedOnly) params.flaggedOnly = true;

      const result = await getAuditLogs(params);
      setLogs(result.data);
      setTotal(result.total);
    } catch {
      setError('Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, auditLogAction, auditLogSearch, auditLogTargetType, auditLogGatewayId, ipAddress, geoCountry, startDate, endDate, auditLogSortBy, auditLogSortOrder, flaggedOnly]);

  const fetchDbLogs = useCallback(async () => {
    setDbLoading(true);
    setDbError('');
    try {
      const params: DbAuditLogParams = {
        page: dbPage + 1,
        limit: dbRowsPerPage,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      };
      if (dbSearch) params.search = dbSearch;
      if (dbQueryType) params.queryType = dbQueryType as DbQueryType;
      if (dbConnectionId) params.connectionId = dbConnectionId;
      if (dbUserId) params.userId = dbUserId;
      if (dbBlocked === 'true') params.blocked = true;
      if (dbBlocked === 'false') params.blocked = false;
      if (dbStartDate) params.startDate = dbStartDate;
      if (dbEndDate) params.endDate = dbEndDate;

      const result = await getDbAuditLogs(params);
      setDbLogs(result.data);
      setDbTotal(result.total);
    } catch {
      setDbError('Failed to load SQL audit logs');
    } finally {
      setDbLoading(false);
    }
  }, [dbPage, dbRowsPerPage, dbSearch, dbQueryType, dbConnectionId, dbUserId, dbBlocked, dbStartDate, dbEndDate]);

  useEffect(() => {
    if (open && activeTab === 'general') {
      fetchLogs();
      getAuditGateways().then(setGateways).catch(() => {});
      getAuditCountries().then(setCountries).catch(() => {});
    }
  }, [open, fetchLogs, activeTab]);

  useEffect(() => {
    if (open && activeTab === 'sql' && hasTenant) {
      fetchDbLogs();
      getDbAuditConnections().then(setDbConnections).catch(() => {});
      getDbAuditUsers().then(setDbUsers).catch(() => {});
    }
  }, [open, fetchDbLogs, activeTab, hasTenant]);

  // Auto-refresh
  const fetchLogsRef = useRef(fetchLogs);
  fetchLogsRef.current = fetchLogs;
  const fetchDbLogsRef = useRef(fetchDbLogs);
  fetchDbLogsRef.current = fetchDbLogs;

  useEffect(() => {
    if (!open || autoRefreshPaused) return;
    if (activeTab === 'general' && page !== 0) return;
    if (activeTab === 'sql' && dbPage !== 0) return;
    const id = setInterval(() => {
      if (activeTab === 'general') fetchLogsRef.current();
      else if (activeTab === 'sql') fetchDbLogsRef.current();
    }, AUTO_REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [open, autoRefreshPaused, page, dbPage, activeTab]);

  const handleChangePage = (_: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(e.target.value, 10));
    setPage(0);
  };

  const handleSort = (field: 'createdAt' | 'action') => {
    if (auditLogSortBy === field) {
      setUiPref('auditLogSortOrder', auditLogSortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setUiPref('auditLogSortBy', field);
      setUiPref('auditLogSortOrder', field === 'createdAt' ? 'desc' : 'asc');
    }
    setPage(0);
  };

  const hasActiveFilters = auditLogAction || auditLogSearch || auditLogTargetType || auditLogGatewayId || ipAddress || geoCountry || startDate || endDate || flaggedOnly;
  const hasDbActiveFilters = dbSearch || dbQueryType || dbConnectionId || dbUserId || dbBlocked || dbStartDate || dbEndDate;

  const handleViewRecording = async (log: AuditLogEntry) => {
    const sessionId = (log.details as Record<string, unknown>)?.sessionId as string | undefined;
    const recordingId = (log.details as Record<string, unknown>)?.recordingId as string | undefined;
    if (!sessionId && !recordingId) return;

    setLoadingRecordingId(log.id);
    try {
      let recording: Recording;
      if (recordingId) {
        recording = await getRecording(recordingId);
      } else {
        recording = await getSessionRecording(sessionId!);
      }
      setSelectedRecording(recording);
      setRecordingPlayerOpen(true);
    } catch {
      // Recording not found or not available
    } finally {
      setLoadingRecordingId(null);
    }
  };

  return (
    <Dialog
      fullScreen
      open={open}
      onClose={onClose}
      TransitionComponent={SlideUp}
    >
      <AppBar position="static" sx={{ position: 'relative' }}>
        <Toolbar variant="dense">
          <IconButton edge="start" color="inherit" onClick={onClose} sx={{ mr: 1 }}>
            <CloseIcon />
          </IconButton>
          <Typography variant="h6" sx={{ flex: 1 }}>Activity Log</Typography>
          <Tooltip title={autoRefreshPaused ? 'Resume live updates' : 'Pause live updates'}>
            <IconButton
              color="inherit"
              onClick={() => setUiPref('auditLogAutoRefreshPaused', !autoRefreshPaused)}
              sx={{ mr: 0.5 }}
            >
              {autoRefreshPaused ? <PlayArrowIcon /> : <PauseIcon />}
            </IconButton>
          </Tooltip>
          <Chip
            label={autoRefreshPaused ? 'Paused' : 'Live'}
            size="small"
            color={autoRefreshPaused ? 'default' : 'success'}
            variant={autoRefreshPaused ? 'outlined' : 'filled'}
            sx={{
              color: autoRefreshPaused ? 'inherit' : undefined,
              fontWeight: 600,
              ...(!autoRefreshPaused && {
                '& .MuiChip-label::before': {
                  content: '""',
                  display: 'inline-block',
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  backgroundColor: 'currentColor',
                  mr: 0.75,
                  animation: 'auditLivePulse 1.5s ease-in-out infinite',
                },
                '@keyframes auditLivePulse': {
                  '0%, 100%': { opacity: 1 },
                  '50%': { opacity: 0.3 },
                },
              }),
            }}
          />
        </Toolbar>
        {hasTenant && (
          <Tabs
            value={activeTab}
            onChange={(_, v) => setUiPref('auditLogDialogTab', v as string)}
            sx={{ bgcolor: 'background.paper', minHeight: 36 }}
            textColor="primary"
            indicatorColor="primary"
          >
            <Tab value="general" label="General" icon={<ListIcon />} iconPosition="start" sx={{ minHeight: 36, textTransform: 'none' }} />
            <Tab value="sql" label="SQL Audit" icon={<StorageIcon />} iconPosition="start" sx={{ minHeight: 36, textTransform: 'none' }} />
          </Tabs>
        )}
      </AppBar>

      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        {activeTab === 'general' && (
          <>
            <Card sx={{ mb: 2 }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <TextField
                  size="small"
                  fullWidth
                  placeholder="Search across target, IP address, and details..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
                      ),
                    },
                  }}
                  sx={{ mb: 1.5 }}
                />
                <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
                  <FormControl size="small" sx={{ minWidth: 200 }}>
                    <InputLabel>Action</InputLabel>
                    <Select
                      value={auditLogAction}
                      label="Action"
                      onChange={(e) => {
                        setUiPref('auditLogAction', e.target.value);
                        setPage(0);
                      }}
                    >
                      <MenuItem value="">All Actions</MenuItem>
                      {ALL_ACTIONS.map((action) => (
                        <MenuItem key={action} value={action}>
                          {ACTION_LABELS[action]}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl size="small" sx={{ minWidth: 160 }}>
                    <InputLabel>Target Type</InputLabel>
                    <Select
                      value={auditLogTargetType}
                      label="Target Type"
                      onChange={(e) => {
                        setUiPref('auditLogTargetType', e.target.value);
                        setPage(0);
                      }}
                    >
                      <MenuItem value="">All Types</MenuItem>
                      {TARGET_TYPES.map((type) => (
                        <MenuItem key={type} value={type}>{type}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  {gateways.length > 0 && (
                    <FormControl size="small" sx={{ minWidth: 160 }}>
                      <InputLabel>Gateway</InputLabel>
                      <Select
                        value={auditLogGatewayId}
                        label="Gateway"
                        onChange={(e) => {
                          setUiPref('auditLogGatewayId', e.target.value);
                          setPage(0);
                        }}
                      >
                        <MenuItem value="">All Gateways</MenuItem>
                        {gateways.map((gw) => (
                          <MenuItem key={gw.id} value={gw.id}>{gw.name}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}
                  {countries.length > 0 && (
                    <FormControl size="small" sx={{ minWidth: 160 }}>
                      <InputLabel>Country</InputLabel>
                      <Select
                        value={geoCountry}
                        label="Country"
                        onChange={(e) => {
                          setGeoCountry(e.target.value);
                          setPage(0);
                        }}
                      >
                        <MenuItem value="">All Countries</MenuItem>
                        {countries.map((c) => (
                          <MenuItem key={c} value={c}>{c}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}
                  <TextField
                    size="small"
                    label="IP Address"
                    value={ipAddress}
                    onChange={(e) => { setIpAddress(e.target.value); setPage(0); }}
                    sx={{ width: 160 }}
                  />
                  <TextField
                    size="small"
                    type="date"
                    label="From"
                    value={startDate}
                    onChange={(e) => { setStartDate(e.target.value); setPage(0); }}
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                  <TextField
                    size="small"
                    type="date"
                    label="To"
                    value={endDate}
                    onChange={(e) => { setEndDate(e.target.value); setPage(0); }}
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                  <Tooltip title="Show only flagged entries (e.g. impossible travel)">
                    <Chip
                      icon={<WarningIcon fontSize="small" />}
                      label="Flagged"
                      size="small"
                      color={flaggedOnly ? 'warning' : 'default'}
                      variant={flaggedOnly ? 'filled' : 'outlined'}
                      onClick={() => { setFlaggedOnly(!flaggedOnly); setPage(0); }}
                      sx={{ cursor: 'pointer' }}
                    />
                  </Tooltip>
                </Stack>
              </CardContent>
            </Card>

            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

            <Card>
              {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                  <CircularProgress />
                </Box>
              ) : logs.length === 0 ? (
                <Box sx={{ textAlign: 'center', py: 6 }}>
                  <Typography color="text.secondary">
                    {hasActiveFilters
                      ? 'No logs match your filters'
                      : 'No activity recorded yet'}
                  </Typography>
                </Box>
              ) : (
                <>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell padding="checkbox" />
                        <TableCell>
                          <TableSortLabel
                            active={auditLogSortBy === 'createdAt'}
                            direction={auditLogSortBy === 'createdAt' ? (auditLogSortOrder as 'asc' | 'desc') : 'asc'}
                            onClick={() => handleSort('createdAt')}
                          >
                            Date/Time
                          </TableSortLabel>
                        </TableCell>
                        <TableCell>
                          <TableSortLabel
                            active={auditLogSortBy === 'action'}
                            direction={auditLogSortBy === 'action' ? (auditLogSortOrder as 'asc' | 'desc') : 'asc'}
                            onClick={() => handleSort('action')}
                          >
                            Action
                          </TableSortLabel>
                        </TableCell>
                        <TableCell>Target</TableCell>
                        <TableCell>IP Address</TableCell>
                        <TableCell>Details</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {logs.map((log) => {
                        const isExpanded = expandedRowId === log.id;
                        return (
                          <Fragment key={log.id}>
                            <TableRow
                              hover
                              onClick={() => setExpandedRowId(isExpanded ? null : log.id)}
                              sx={{ cursor: 'pointer', '& > *': { borderBottom: isExpanded ? 'unset' : undefined } }}
                            >
                              <TableCell padding="checkbox">
                                <IconButton size="small">
                                  {isExpanded ? <CollapseIcon /> : <ExpandIcon />}
                                </IconButton>
                              </TableCell>
                              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                {new Date(log.createdAt).toLocaleString()}
                              </TableCell>
                              <TableCell>
                                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                                  <Chip
                                    label={ACTION_LABELS[log.action] || log.action}
                                    color={getActionColor(log.action)}
                                    size="small"
                                  />
                                  {log.flags?.includes('IMPOSSIBLE_TRAVEL') && (
                                    <Tooltip title="Impossible travel detected">
                                      <WarningIcon color="warning" fontSize="small" />
                                    </Tooltip>
                                  )}
                                  {['SESSION_START', 'SESSION_END', 'SESSION_TERMINATED_POLICY_VIOLATION'].includes(log.action) &&
                                    Boolean((log.details as Record<string, unknown>)?.sessionId) && (
                                    <Tooltip title="View Recording">
                                      <IconButton
                                        size="small"
                                        onClick={(e) => { e.stopPropagation(); handleViewRecording(log); }}
                                        disabled={loadingRecordingId === log.id}
                                      >
                                        {loadingRecordingId === log.id ? <CircularProgress size={16} /> : <PlayArrowIcon fontSize="small" />}
                                      </IconButton>
                                    </Tooltip>
                                  )}
                                </Box>
                              </TableCell>
                              <TableCell>
                                {log.targetType
                                  ? `${log.targetType}${log.targetId ? ` ${log.targetId.slice(0, 8)}...` : ''}`
                                  : '\u2014'}
                              </TableCell>
                              <TableCell>
                                <IpGeoCell ipAddress={log.ipAddress} geoCountry={log.geoCountry} geoCity={log.geoCity} onGeoIpClick={onGeoIpClick} />
                              </TableCell>
                              <TableCell sx={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {formatDetails(log.details)}
                              </TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell colSpan={6} sx={{ py: 0, borderBottom: isExpanded ? undefined : 'none' }}>
                                <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                                  <Box sx={{ py: 2, px: 3 }}>
                                    {log.details && typeof log.details === 'object' && Object.keys(log.details).length > 0 ? (
                                      <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 1, maxWidth: 600 }}>
                                        {Object.entries(log.details).map(([key, value]) => (
                                          <Fragment key={key}>
                                            <Typography variant="body2" fontWeight={600} color="text.secondary">
                                              {key}
                                            </Typography>
                                            <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                                              {Array.isArray(value) ? value.join(', ') : String(value)}
                                            </Typography>
                                          </Fragment>
                                        ))}
                                      </Box>
                                    ) : (
                                      <Typography variant="body2" color="text.secondary">No additional details</Typography>
                                    )}
                                    {log.targetId && (
                                      <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                        Full Target ID: {log.targetId}
                                      </Typography>
                                    )}
                                  </Box>
                                </Collapse>
                              </TableCell>
                            </TableRow>
                          </Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                  <TablePagination
                    component="div"
                    count={total}
                    page={page}
                    onPageChange={handleChangePage}
                    rowsPerPage={rowsPerPage}
                    onRowsPerPageChange={handleChangeRowsPerPage}
                    rowsPerPageOptions={[25, 50, 100]}
                  />
                </>
              )}
            </Card>
          </>
        )}

        {activeTab === 'sql' && hasTenant && (
          <>
            <Card sx={{ mb: 2 }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <TextField
                  size="small"
                  fullWidth
                  placeholder="Search SQL queries, tables, or block reasons..."
                  value={dbSearch}
                  onChange={(e) => { setDbSearch(e.target.value); setDbPage(0); }}
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
                      ),
                    },
                  }}
                  sx={{ mb: 1.5 }}
                />
                <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
                  <FormControl size="small" sx={{ minWidth: 140 }}>
                    <InputLabel>Query Type</InputLabel>
                    <Select
                      value={dbQueryType}
                      label="Query Type"
                      onChange={(e) => { setDbQueryType(e.target.value); setDbPage(0); }}
                    >
                      <MenuItem value="">All Types</MenuItem>
                      {ALL_QUERY_TYPES.map((qt) => (
                        <MenuItem key={qt} value={qt}>{QUERY_TYPE_LABELS[qt]}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  {dbConnections.length > 0 && (
                    <FormControl size="small" sx={{ minWidth: 160 }}>
                      <InputLabel>Connection</InputLabel>
                      <Select
                        value={dbConnectionId}
                        label="Connection"
                        onChange={(e) => { setDbConnectionId(e.target.value); setDbPage(0); }}
                      >
                        <MenuItem value="">All Connections</MenuItem>
                        {dbConnections.map((c) => (
                          <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}
                  {dbUsers.length > 0 && (
                    <FormControl size="small" sx={{ minWidth: 160 }}>
                      <InputLabel>User</InputLabel>
                      <Select
                        value={dbUserId}
                        label="User"
                        onChange={(e) => { setDbUserId(e.target.value); setDbPage(0); }}
                      >
                        <MenuItem value="">All Users</MenuItem>
                        {dbUsers.map((u) => (
                          <MenuItem key={u.id} value={u.id}>{u.username || u.email}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}
                  <FormControl size="small" sx={{ minWidth: 130 }}>
                    <InputLabel>Status</InputLabel>
                    <Select
                      value={dbBlocked}
                      label="Status"
                      onChange={(e) => { setDbBlocked(e.target.value); setDbPage(0); }}
                    >
                      <MenuItem value="">All</MenuItem>
                      <MenuItem value="true">Blocked</MenuItem>
                      <MenuItem value="false">Allowed</MenuItem>
                    </Select>
                  </FormControl>
                  <TextField
                    size="small"
                    type="date"
                    label="From"
                    value={dbStartDate}
                    onChange={(e) => { setDbStartDate(e.target.value); setDbPage(0); }}
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                  <TextField
                    size="small"
                    type="date"
                    label="To"
                    value={dbEndDate}
                    onChange={(e) => { setDbEndDate(e.target.value); setDbPage(0); }}
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                </Stack>
              </CardContent>
            </Card>

            {dbError && <Alert severity="error" sx={{ mb: 2 }}>{dbError}</Alert>}

            <Card>
              {dbLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                  <CircularProgress />
                </Box>
              ) : dbLogs.length === 0 ? (
                <Box sx={{ textAlign: 'center', py: 6 }}>
                  <Typography color="text.secondary">
                    {hasDbActiveFilters
                      ? 'No SQL audit logs match your filters'
                      : 'No SQL queries recorded yet'}
                  </Typography>
                </Box>
              ) : (
                <>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell padding="checkbox" />
                        <TableCell>Date/Time</TableCell>
                        <TableCell>User</TableCell>
                        <TableCell>Connection</TableCell>
                        <TableCell>Type</TableCell>
                        <TableCell>Tables</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>Time (ms)</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {dbLogs.map((entry) => {
                        const isExpanded = dbExpandedRowId === entry.id;
                        return (
                          <Fragment key={entry.id}>
                            <TableRow
                              hover
                              onClick={() => setDbExpandedRowId(isExpanded ? null : entry.id)}
                              sx={{ cursor: 'pointer', '& > *': { borderBottom: isExpanded ? 'unset' : undefined } }}
                            >
                              <TableCell padding="checkbox">
                                <IconButton size="small">
                                  {isExpanded ? <CollapseIcon /> : <ExpandIcon />}
                                </IconButton>
                              </TableCell>
                              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                {new Date(entry.createdAt).toLocaleString()}
                              </TableCell>
                              <TableCell>{entry.userName || entry.userEmail || entry.userId.slice(0, 8)}</TableCell>
                              <TableCell>{entry.connectionName || entry.connectionId.slice(0, 8)}</TableCell>
                              <TableCell>
                                <Chip
                                  label={QUERY_TYPE_LABELS[entry.queryType] || entry.queryType}
                                  color={QUERY_TYPE_COLORS[entry.queryType] || 'default'}
                                  size="small"
                                />
                              </TableCell>
                              <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {entry.tablesAccessed.length > 0 ? entry.tablesAccessed.join(', ') : '\u2014'}
                              </TableCell>
                              <TableCell>
                                {entry.blocked ? (
                                  <Chip label="Blocked" color="error" size="small" />
                                ) : entry.blockReason ? (
                                  <Chip label="Alert" color="warning" size="small" />
                                ) : (
                                  <Chip label="OK" color="success" size="small" variant="outlined" />
                                )}
                              </TableCell>
                              <TableCell>
                                {entry.executionTimeMs !== null ? `${entry.executionTimeMs}` : '\u2014'}
                              </TableCell>
                            </TableRow>
                            <TableRow>
                              <TableCell colSpan={8} sx={{ py: 0, borderBottom: isExpanded ? undefined : 'none' }}>
                                <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                                  <Box sx={{ py: 2, px: 3, maxWidth: 800 }}>
                                    <Typography variant="body2" fontWeight={600} color="text.secondary" gutterBottom>
                                      Query
                                    </Typography>
                                    <Box
                                      sx={{
                                        p: 1.5, bgcolor: 'action.hover', borderRadius: 1,
                                        fontFamily: 'monospace', fontSize: '0.85rem',
                                        whiteSpace: 'pre-wrap', wordBreak: 'break-all', mb: 1.5,
                                      }}
                                    >
                                      {entry.queryText}
                                    </Box>
                                    <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 1 }}>
                                      <Typography variant="body2" fontWeight={600} color="text.secondary">Rows Affected</Typography>
                                      <Typography variant="body2">{entry.rowsAffected ?? '\u2014'}</Typography>
                                      {entry.blockReason && (
                                        <>
                                          <Typography variant="body2" fontWeight={600} color="text.secondary">
                                            {entry.blocked ? 'Block Reason' : 'Firewall Alert'}
                                          </Typography>
                                          <Typography variant="body2" color={entry.blocked ? 'error.main' : 'warning.main'}>
                                            {entry.blockReason}
                                          </Typography>
                                        </>
                                      )}
                                    </Box>
                                    <Box sx={{ mt: 1.5 }}>
                                      <Tooltip title="Open query visualizer">
                                        <IconButton
                                          size="small"
                                          color="primary"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setVisualizerEntry(entry);
                                          }}
                                        >
                                          <VisualizeIcon fontSize="small" />
                                        </IconButton>
                                      </Tooltip>
                                    </Box>
                                  </Box>
                                </Collapse>
                              </TableCell>
                            </TableRow>
                          </Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                  <TablePagination
                    component="div"
                    count={dbTotal}
                    page={dbPage}
                    onPageChange={(_, p) => setDbPage(p)}
                    rowsPerPage={dbRowsPerPage}
                    onRowsPerPageChange={(e) => { setDbRowsPerPage(parseInt(e.target.value, 10)); setDbPage(0); }}
                    rowsPerPageOptions={[25, 50, 100]}
                  />
                </>
              )}
            </Card>
          </>
        )}
      </Box>

      {/* Query Visualizer drawer */}
      <QueryVisualizer
        open={Boolean(visualizerEntry)}
        onClose={() => setVisualizerEntry(null)}
        queryText={visualizerEntry?.queryText ?? ''}
        queryType={visualizerEntry?.queryType ?? ''}
        executionTimeMs={visualizerEntry?.executionTimeMs ?? null}
        rowsAffected={visualizerEntry?.rowsAffected ?? null}
        tablesAccessed={visualizerEntry?.tablesAccessed ?? []}
        blocked={visualizerEntry?.blocked ?? false}
        blockReason={visualizerEntry?.blockReason}
        storedExecutionPlan={visualizerEntry?.executionPlan ?? null}
      />

      <RecordingPlayerDialog
        open={recordingPlayerOpen}
        onClose={() => { setRecordingPlayerOpen(false); setSelectedRecording(null); }}
        recording={selectedRecording}
      />
    </Dialog>
  );
}
