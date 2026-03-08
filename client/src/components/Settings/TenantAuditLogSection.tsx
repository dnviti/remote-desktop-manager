import { useState, useEffect, useCallback, Fragment } from 'react';
import {
  Card, CardContent, Typography, Box,
  Table, TableHead, TableBody, TableRow, TableCell, TablePagination,
  Select, MenuItem, FormControl, InputLabel, TextField, Stack,
  CircularProgress, Chip, Alert, Collapse, TableSortLabel, InputAdornment,
  IconButton, Autocomplete, Button,
} from '@mui/material';
import {
  Search as SearchIcon,
  KeyboardArrowDown as ExpandIcon,
  KeyboardArrowUp as CollapseIcon,
  Download as DownloadIcon,
} from '@mui/icons-material';
import {
  getTenantAuditLogs, getTenantAuditGateways,
  TenantAuditLogEntry, AuditAction, TenantAuditLogParams, AuditGateway,
} from '../../api/audit.api';
import { useUiPreferencesStore } from '../../store/uiPreferencesStore';
import { useTenantStore } from '../../store/tenantStore';
import { ACTION_LABELS, getActionColor, formatDetails, ALL_ACTIONS, TARGET_TYPES } from '../Audit/auditConstants';

function exportCsv(logs: TenantAuditLogEntry[]) {
  const header = 'Date,User,Email,Action,Target Type,Target ID,IP Address,Details';
  const rows = logs.map((log) => {
    const date = new Date(log.createdAt).toISOString();
    const user = (log.userName ?? '').replace(/"/g, '""');
    const email = (log.userEmail ?? '').replace(/"/g, '""');
    const action = ACTION_LABELS[log.action] || log.action;
    const targetType = log.targetType ?? '';
    const targetId = log.targetId ?? '';
    const ip = log.ipAddress ?? '';
    const details = formatDetails(log.details as Record<string, unknown> | null).replace(/"/g, '""');
    return `"${date}","${user}","${email}","${action}","${targetType}","${targetId}","${ip}","${details}"`;
  });
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tenant-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function TenantAuditLogSection() {
  const tenantAuditLogAction = useUiPreferencesStore((s) => s.tenantAuditLogAction);
  const tenantAuditLogSearch = useUiPreferencesStore((s) => s.tenantAuditLogSearch);
  const tenantAuditLogTargetType = useUiPreferencesStore((s) => s.tenantAuditLogTargetType);
  const tenantAuditLogGatewayId = useUiPreferencesStore((s) => s.tenantAuditLogGatewayId);
  const tenantAuditLogUserId = useUiPreferencesStore((s) => s.tenantAuditLogUserId);
  const tenantAuditLogSortBy = useUiPreferencesStore((s) => s.tenantAuditLogSortBy);
  const tenantAuditLogSortOrder = useUiPreferencesStore((s) => s.tenantAuditLogSortOrder);
  const setUiPref = useUiPreferencesStore((s) => s.set);

  const users = useTenantStore((s) => s.users);
  const fetchUsers = useTenantStore((s) => s.fetchUsers);

  const [logs, setLogs] = useState<TenantAuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [ipAddress, setIpAddress] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(tenantAuditLogSearch);
  const [gateways, setGateways] = useState<AuditGateway[]>([]);

  useEffect(() => {
    if (users.length === 0) fetchUsers();
  }, [users.length, fetchUsers]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setUiPref('tenantAuditLogSearch', searchInput);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, setUiPref]);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: TenantAuditLogParams = {
        page: page + 1,
        limit: rowsPerPage,
        sortBy: tenantAuditLogSortBy as 'createdAt' | 'action',
        sortOrder: tenantAuditLogSortOrder as 'asc' | 'desc',
      };
      if (tenantAuditLogAction) params.action = tenantAuditLogAction as AuditAction;
      if (tenantAuditLogSearch) params.search = tenantAuditLogSearch;
      if (tenantAuditLogTargetType) params.targetType = tenantAuditLogTargetType;
      if (tenantAuditLogGatewayId) params.gatewayId = tenantAuditLogGatewayId;
      if (tenantAuditLogUserId) params.userId = tenantAuditLogUserId;
      if (ipAddress) params.ipAddress = ipAddress;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;

      const result = await getTenantAuditLogs(params);
      setLogs(result.data);
      setTotal(result.total);
    } catch {
      setError('Failed to load tenant audit logs');
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, tenantAuditLogAction, tenantAuditLogSearch, tenantAuditLogTargetType, tenantAuditLogGatewayId, tenantAuditLogUserId, ipAddress, startDate, endDate, tenantAuditLogSortBy, tenantAuditLogSortOrder]);

  useEffect(() => {
    fetchLogs();
    getTenantAuditGateways().then(setGateways).catch(() => {});
  }, [fetchLogs]);

  const handleSort = (field: 'createdAt' | 'action') => {
    if (tenantAuditLogSortBy === field) {
      setUiPref('tenantAuditLogSortOrder', tenantAuditLogSortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setUiPref('tenantAuditLogSortBy', field);
      setUiPref('tenantAuditLogSortOrder', field === 'createdAt' ? 'desc' : 'asc');
    }
    setPage(0);
  };

  const selectedUser = users.find((u) => u.id === tenantAuditLogUserId) ?? null;

  const hasActiveFilters = tenantAuditLogAction || tenantAuditLogSearch || tenantAuditLogTargetType || tenantAuditLogGatewayId || tenantAuditLogUserId || ipAddress || startDate || endDate;

  return (
    <Card>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Typography variant="h6">Organization Audit Log</Typography>
          <Button
            size="small"
            startIcon={<DownloadIcon />}
            onClick={() => exportCsv(logs)}
            disabled={logs.length === 0}
          >
            Export CSV
          </Button>
        </Stack>

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

        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
          <Autocomplete
            size="small"
            sx={{ minWidth: 220 }}
            options={users}
            getOptionLabel={(u) => u.username ?? u.email}
            value={selectedUser}
            onChange={(_, val) => {
              setUiPref('tenantAuditLogUserId', val?.id ?? '');
              setPage(0);
            }}
            renderInput={(params) => <TextField {...params} label="User" />}
            isOptionEqualToValue={(opt, val) => opt.id === val.id}
          />
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel>Action</InputLabel>
            <Select
              value={tenantAuditLogAction}
              label="Action"
              onChange={(e) => {
                setUiPref('tenantAuditLogAction', e.target.value);
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
              value={tenantAuditLogTargetType}
              label="Target Type"
              onChange={(e) => {
                setUiPref('tenantAuditLogTargetType', e.target.value);
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
                value={tenantAuditLogGatewayId}
                label="Gateway"
                onChange={(e) => {
                  setUiPref('tenantAuditLogGatewayId', e.target.value);
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

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

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
                      active={tenantAuditLogSortBy === 'createdAt'}
                      direction={tenantAuditLogSortBy === 'createdAt' ? (tenantAuditLogSortOrder as 'asc' | 'desc') : 'asc'}
                      onClick={() => handleSort('createdAt')}
                    >
                      Date/Time
                    </TableSortLabel>
                  </TableCell>
                  <TableCell>User</TableCell>
                  <TableCell>
                    <TableSortLabel
                      active={tenantAuditLogSortBy === 'action'}
                      direction={tenantAuditLogSortBy === 'action' ? (tenantAuditLogSortOrder as 'asc' | 'desc') : 'asc'}
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
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          {log.userName ?? log.userEmail ?? '\u2014'}
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
                          {formatDetails(log.details as Record<string, unknown> | null)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell colSpan={7} sx={{ py: 0, borderBottom: isExpanded ? undefined : 'none' }}>
                          <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                            <Box sx={{ py: 2, px: 3 }}>
                              {log.details && typeof log.details === 'object' && Object.keys(log.details as object).length > 0 ? (
                                <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 1, maxWidth: 600 }}>
                                  {Object.entries(log.details as Record<string, unknown>).map(([key, value]) => (
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
                              {log.userEmail && (
                                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                  Email: {log.userEmail}
                                </Typography>
                              )}
                              {log.targetId && (
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
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
              onPageChange={(_, newPage) => setPage(newPage)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(e) => {
                setRowsPerPage(parseInt(e.target.value, 10));
                setPage(0);
              }}
              rowsPerPageOptions={[25, 50, 100]}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
