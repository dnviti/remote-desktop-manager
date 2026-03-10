import { useState, useEffect, useCallback, forwardRef, Fragment } from 'react';
import {
  Dialog, AppBar, Toolbar, Typography, Box, IconButton, Card, CardContent,
  Table, TableHead, TableBody, TableRow, TableCell, TablePagination,
  Select, MenuItem, FormControl, InputLabel, TextField, Stack,
  CircularProgress, Chip, Alert, Slide, Collapse, TableSortLabel, InputAdornment,
  Autocomplete, Button,
} from '@mui/material';
import type { TransitionProps } from '@mui/material/transitions';
import {
  Close as CloseIcon,
  Search as SearchIcon,
  KeyboardArrowDown as ExpandIcon,
  KeyboardArrowUp as CollapseIcon,
  Download as DownloadIcon,
} from '@mui/icons-material';
import {
  getConnectionAuditLogs, getConnectionAuditUsers, getAuditGateways, getAuditCountries,
  TenantAuditLogEntry, AuditAction, ConnectionAuditLogParams, AuditGateway, ConnectionAuditUser,
} from '../../api/audit.api';
import { useUiPreferencesStore } from '../../store/uiPreferencesStore';
import { useAuthStore } from '../../store/authStore';
import { ACTION_LABELS, getActionColor, formatDetails, ALL_ACTIONS } from '../Audit/auditConstants';
import IpGeoCell from '../Audit/IpGeoCell';

const SlideUp = forwardRef(function SlideUp(
  props: TransitionProps & { children: React.ReactElement },
  ref: React.Ref<unknown>,
) {
  return <Slide direction="up" ref={ref} {...props} />;
});

function exportCsv(logs: TenantAuditLogEntry[], connectionName: string) {
  const header = 'Date,User,Email,Action,IP Address,Country,City,Details';
  const rows = logs.map((log) => {
    const date = new Date(log.createdAt).toISOString();
    const user = (log.userName ?? '').replace(/"/g, '""');
    const email = (log.userEmail ?? '').replace(/"/g, '""');
    const action = ACTION_LABELS[log.action] || log.action;
    const ip = log.ipAddress ?? '';
    const country = log.geoCountry ?? '';
    const city = log.geoCity ?? '';
    const details = formatDetails(log.details as Record<string, unknown> | null).replace(/"/g, '""');
    return `"${date}","${user}","${email}","${action}","${ip}","${country}","${city}","${details}"`;
  });
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `connection-audit-log-${connectionName.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

interface ConnectionAuditLogDialogProps {
  open: boolean;
  onClose: () => void;
  connectionId: string;
  connectionName: string;
  onGeoIpClick?: (ip: string) => void;
}

export default function ConnectionAuditLogDialog({ open, onClose, connectionId, connectionName, onGeoIpClick }: ConnectionAuditLogDialogProps) {
  const connAuditLogAction = useUiPreferencesStore((s) => s.connAuditLogAction);
  const connAuditLogSearch = useUiPreferencesStore((s) => s.connAuditLogSearch);
  const connAuditLogGatewayId = useUiPreferencesStore((s) => s.connAuditLogGatewayId);
  const connAuditLogUserId = useUiPreferencesStore((s) => s.connAuditLogUserId);
  const connAuditLogSortBy = useUiPreferencesStore((s) => s.connAuditLogSortBy);
  const connAuditLogSortOrder = useUiPreferencesStore((s) => s.connAuditLogSortOrder);
  const setUiPref = useUiPreferencesStore((s) => s.set);

  const tenantRole = useAuthStore((s) => s.user?.tenantRole);
  const isAdmin = tenantRole === 'ADMIN' || tenantRole === 'OWNER';

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
  const [searchInput, setSearchInput] = useState(connAuditLogSearch);
  const [gateways, setGateways] = useState<AuditGateway[]>([]);
  const [auditUsers, setAuditUsers] = useState<ConnectionAuditUser[]>([]);
  const [countries, setCountries] = useState<string[]>([]);
  const [geoCountry, setGeoCountry] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setUiPref('connAuditLogSearch', searchInput);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, setUiPref]);

  const fetchLogs = useCallback(async () => {
    if (!connectionId) return;
    setLoading(true);
    setError('');
    try {
      const params: ConnectionAuditLogParams = {
        page: page + 1,
        limit: rowsPerPage,
        sortBy: connAuditLogSortBy as 'createdAt' | 'action',
        sortOrder: connAuditLogSortOrder as 'asc' | 'desc',
      };
      if (connAuditLogAction) params.action = connAuditLogAction as AuditAction;
      if (connAuditLogSearch) params.search = connAuditLogSearch;
      if (connAuditLogGatewayId) params.gatewayId = connAuditLogGatewayId;
      if (connAuditLogUserId) params.userId = connAuditLogUserId;
      if (ipAddress) params.ipAddress = ipAddress;
      if (geoCountry) params.geoCountry = geoCountry;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;

      const result = await getConnectionAuditLogs(connectionId, params);
      setLogs(result.data);
      setTotal(result.total);
    } catch {
      setError('Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [connectionId, page, rowsPerPage, connAuditLogAction, connAuditLogSearch, connAuditLogGatewayId, connAuditLogUserId, ipAddress, geoCountry, startDate, endDate, connAuditLogSortBy, connAuditLogSortOrder]);

  useEffect(() => {
    if (open && connectionId) {
      fetchLogs();
      getAuditGateways().then(setGateways).catch(() => {});
      getAuditCountries().then(setCountries).catch(() => {});
      if (isAdmin) {
        getConnectionAuditUsers(connectionId).then(setAuditUsers).catch(() => {});
      }
    }
  }, [open, connectionId, fetchLogs, isAdmin]);

  const handleSort = (field: 'createdAt' | 'action') => {
    if (connAuditLogSortBy === field) {
      setUiPref('connAuditLogSortOrder', connAuditLogSortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setUiPref('connAuditLogSortBy', field);
      setUiPref('connAuditLogSortOrder', field === 'createdAt' ? 'desc' : 'asc');
    }
    setPage(0);
  };

  const selectedUser = auditUsers.find((u) => u.id === connAuditLogUserId) ?? null;
  const colSpan = isAdmin ? 7 : 6;
  const hasActiveFilters = connAuditLogAction || connAuditLogSearch || connAuditLogGatewayId || connAuditLogUserId || ipAddress || geoCountry || startDate || endDate;

  return (
    <Dialog fullScreen open={open} onClose={onClose} TransitionComponent={SlideUp}>
      <AppBar position="static" sx={{ position: 'relative' }}>
        <Toolbar variant="dense">
          <IconButton edge="start" color="inherit" onClick={onClose} sx={{ mr: 1 }}>
            <CloseIcon />
          </IconButton>
          <Typography variant="h6" sx={{ flex: 1 }}>
            Activity Log &mdash; {connectionName}
          </Typography>
          {isAdmin && (
            <Button
              color="inherit"
              size="small"
              startIcon={<DownloadIcon />}
              onClick={() => exportCsv(logs, connectionName)}
              disabled={logs.length === 0}
            >
              Export CSV
            </Button>
          )}
        </Toolbar>
      </AppBar>

      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        <Card sx={{ mb: 2 }}>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
            <TextField
              size="small"
              fullWidth
              placeholder="Search across IP address and details..."
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
              {isAdmin && auditUsers.length > 0 && (
                <Autocomplete
                  size="small"
                  sx={{ minWidth: 220 }}
                  options={auditUsers}
                  getOptionLabel={(u) => u.username ?? u.email}
                  value={selectedUser}
                  onChange={(_, val) => {
                    setUiPref('connAuditLogUserId', val?.id ?? '');
                    setPage(0);
                  }}
                  renderInput={(params) => <TextField {...params} label="User" />}
                  isOptionEqualToValue={(opt, val) => opt.id === val.id}
                />
              )}
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <InputLabel>Action</InputLabel>
                <Select
                  value={connAuditLogAction}
                  label="Action"
                  onChange={(e) => {
                    setUiPref('connAuditLogAction', e.target.value);
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
              {gateways.length > 0 && (
                <FormControl size="small" sx={{ minWidth: 160 }}>
                  <InputLabel>Gateway</InputLabel>
                  <Select
                    value={connAuditLogGatewayId}
                    label="Gateway"
                    onChange={(e) => {
                      setUiPref('connAuditLogGatewayId', e.target.value);
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
                        active={connAuditLogSortBy === 'createdAt'}
                        direction={connAuditLogSortBy === 'createdAt' ? (connAuditLogSortOrder as 'asc' | 'desc') : 'asc'}
                        onClick={() => handleSort('createdAt')}
                      >
                        Date/Time
                      </TableSortLabel>
                    </TableCell>
                    {isAdmin && <TableCell>User</TableCell>}
                    <TableCell>
                      <TableSortLabel
                        active={connAuditLogSortBy === 'action'}
                        direction={connAuditLogSortBy === 'action' ? (connAuditLogSortOrder as 'asc' | 'desc') : 'asc'}
                        onClick={() => handleSort('action')}
                      >
                        Action
                      </TableSortLabel>
                    </TableCell>
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
                          {isAdmin && (
                            <TableCell sx={{ whiteSpace: 'nowrap' }}>
                              {log.userName ?? log.userEmail ?? '\u2014'}
                            </TableCell>
                          )}
                          <TableCell>
                            <Chip
                              label={ACTION_LABELS[log.action] || log.action}
                              color={getActionColor(log.action)}
                              size="small"
                            />
                          </TableCell>
                          <TableCell>
                            <IpGeoCell ipAddress={log.ipAddress} geoCountry={log.geoCountry} geoCity={log.geoCity} onGeoIpClick={onGeoIpClick} />
                          </TableCell>
                          <TableCell sx={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {formatDetails(log.details as Record<string, unknown> | null)}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell colSpan={colSpan} sx={{ py: 0, borderBottom: isExpanded ? undefined : 'none' }}>
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
                                {isAdmin && log.userEmail && (
                                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                    Email: {log.userEmail}
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
        </Card>
      </Box>
    </Dialog>
  );
}
