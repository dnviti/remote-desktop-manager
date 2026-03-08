import { useState, useEffect, useCallback, forwardRef, Fragment } from 'react';
import {
  Dialog, AppBar, Toolbar, Typography, Box, IconButton, Card, CardContent,
  Table, TableHead, TableBody, TableRow, TableCell, TablePagination,
  Select, MenuItem, FormControl, InputLabel, TextField, Stack,
  CircularProgress, Chip, Alert, Slide, Collapse, TableSortLabel, InputAdornment,
} from '@mui/material';
import type { TransitionProps } from '@mui/material/transitions';
import {
  Close as CloseIcon,
  Search as SearchIcon,
  KeyboardArrowDown as ExpandIcon,
  KeyboardArrowUp as CollapseIcon,
} from '@mui/icons-material';
import { getAuditLogs, getAuditGateways, AuditLogEntry, AuditAction, AuditLogParams, AuditGateway } from '../../api/audit.api';
import { useUiPreferencesStore } from '../../store/uiPreferencesStore';
import { ACTION_LABELS, getActionColor, formatDetails, ALL_ACTIONS, TARGET_TYPES } from '../Audit/auditConstants';

const SlideUp = forwardRef(function SlideUp(
  props: TransitionProps & { children: React.ReactElement },
  ref: React.Ref<unknown>,
) {
  return <Slide direction="up" ref={ref} {...props} />;
});

interface AuditLogDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function AuditLogDialog({ open, onClose }: AuditLogDialogProps) {
  const auditLogAction = useUiPreferencesStore((s) => s.auditLogAction);
  const auditLogSearch = useUiPreferencesStore((s) => s.auditLogSearch);
  const auditLogTargetType = useUiPreferencesStore((s) => s.auditLogTargetType);
  const auditLogGatewayId = useUiPreferencesStore((s) => s.auditLogGatewayId);
  const auditLogSortBy = useUiPreferencesStore((s) => s.auditLogSortBy);
  const auditLogSortOrder = useUiPreferencesStore((s) => s.auditLogSortOrder);
  const setUiPref = useUiPreferencesStore((s) => s.set);

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

  // Debounce search input → store
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
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;

      const result = await getAuditLogs(params);
      setLogs(result.data);
      setTotal(result.total);
    } catch {
      setError('Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, auditLogAction, auditLogSearch, auditLogTargetType, auditLogGatewayId, ipAddress, startDate, endDate, auditLogSortBy, auditLogSortOrder]);

  useEffect(() => {
    if (open) {
      fetchLogs();
      getAuditGateways().then(setGateways).catch(() => {});
    }
  }, [open, fetchLogs]);

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

  const hasActiveFilters = auditLogAction || auditLogSearch || auditLogTargetType || auditLogGatewayId || ipAddress || startDate || endDate;

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
          <Typography variant="h6">Activity Log</Typography>
        </Toolbar>
      </AppBar>

      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
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
                            <Chip
                              label={ACTION_LABELS[log.action] || log.action}
                              color={getActionColor(log.action)}
                              size="small"
                            />
                          </TableCell>
                          <TableCell>
                            {log.targetType
                              ? `${log.targetType}${log.targetId ? ` ${log.targetId.slice(0, 8)}...` : ''}`
                              : '\u2014'}
                          </TableCell>
                          <TableCell>{log.ipAddress || '\u2014'}</TableCell>
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
      </Box>
    </Dialog>
  );
}
