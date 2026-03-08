import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box, Paper, Typography, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, IconButton, Tooltip, FormControl, InputLabel,
  Select, MenuItem, Button, Switch, FormControlLabel, Dialog, DialogTitle,
  DialogContent, DialogContentText, DialogActions, Stack,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Stop as StopIcon,
  Computer as ComputerIcon,
  Dns as DnsIcon,
  Terminal as TerminalIcon,
} from '@mui/icons-material';
import { useGatewayStore } from '../../store/gatewayStore';
import { useUiPreferencesStore } from '../../store/uiPreferencesStore';

const statusColor: Record<string, 'success' | 'warning' | 'default'> = {
  ACTIVE: 'success',
  IDLE: 'warning',
  CLOSED: 'default',
};

export default function SessionDashboard() {
  const activeSessions = useGatewayStore((s) => s.activeSessions);
  const sessionCount = useGatewayStore((s) => s.sessionCount);
  const sessionsLoading = useGatewayStore((s) => s.sessionsLoading);
  const gateways = useGatewayStore((s) => s.gateways);
  const fetchActiveSessions = useGatewayStore((s) => s.fetchActiveSessions);
  const fetchSessionCount = useGatewayStore((s) => s.fetchSessionCount);
  const terminateSessionAction = useGatewayStore((s) => s.terminateSession);

  const autoRefresh = useUiPreferencesStore((s) => s.orchestrationAutoRefresh);
  const refreshInterval = useUiPreferencesStore((s) => s.orchestrationRefreshInterval);
  const toggleAutoRefresh = useUiPreferencesStore((s) => s.toggle);

  const [protocolFilter, setProtocolFilter] = useState<string>('');
  const [gatewayFilter, setGatewayFilter] = useState<string>('');
  const [terminateTarget, setTerminateTarget] = useState<{ id: string; label: string } | null>(null);

  const filters = useMemo(() => {
    const f: { protocol?: 'SSH' | 'RDP'; gatewayId?: string } = {};
    if (protocolFilter) f.protocol = protocolFilter as 'SSH' | 'RDP';
    if (gatewayFilter) f.gatewayId = gatewayFilter;
    return f;
  }, [protocolFilter, gatewayFilter]);

  const refresh = useCallback(() => {
    fetchActiveSessions(filters);
    fetchSessionCount();
  }, [filters, fetchActiveSessions, fetchSessionCount]);

  useEffect(() => {
    refresh();
    if (!autoRefresh) return;
    const timer = setInterval(refresh, refreshInterval);
    return () => clearInterval(timer);
  }, [refresh, autoRefresh, refreshInterval]);

  const sshCount = activeSessions.filter((s) => s.protocol === 'SSH').length;
  const rdpCount = activeSessions.filter((s) => s.protocol === 'RDP').length;
  const managedGateways = gateways.filter((g) => g.isManaged).length;

  const handleTerminate = async () => {
    if (!terminateTarget) return;
    try {
      await terminateSessionAction(terminateTarget.id);
    } finally {
      setTerminateTarget(null);
    }
  };

  return (
    <Box>
      {/* Metric cards */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        <MetricCard label="Total Active" value={sessionCount} icon={<ComputerIcon />} />
        <MetricCard label="SSH Sessions" value={sshCount} icon={<TerminalIcon />} />
        <MetricCard label="RDP Sessions" value={rdpCount} icon={<DnsIcon />} />
        <MetricCard label="Managed Gateways" value={managedGateways} icon={<DnsIcon />} />
      </Box>

      {/* Filters */}
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }} flexWrap="wrap">
        <FormControl size="small" sx={{ minWidth: 130 }}>
          <InputLabel>Protocol</InputLabel>
          <Select value={protocolFilter} label="Protocol" onChange={(e) => setProtocolFilter(e.target.value)}>
            <MenuItem value="">All</MenuItem>
            <MenuItem value="SSH">SSH</MenuItem>
            <MenuItem value="RDP">RDP</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>Gateway</InputLabel>
          <Select value={gatewayFilter} label="Gateway" onChange={(e) => setGatewayFilter(e.target.value)}>
            <MenuItem value="">All</MenuItem>
            {gateways.map((gw) => (
              <MenuItem key={gw.id} value={gw.id}>{gw.name}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button
          startIcon={<RefreshIcon />}
          onClick={refresh}
          size="small"
          variant="outlined"
          disabled={sessionsLoading}
        >
          Refresh
        </Button>
        <FormControlLabel
          control={
            <Switch
              checked={autoRefresh}
              onChange={() => toggleAutoRefresh('orchestrationAutoRefresh')}
              size="small"
            />
          }
          label="Auto-refresh"
        />
      </Stack>

      {/* Sessions table */}
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>User</TableCell>
              <TableCell>Connection</TableCell>
              <TableCell>Protocol</TableCell>
              <TableCell>Gateway</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Started</TableCell>
              <TableCell>Last Activity</TableCell>
              <TableCell>Duration</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {activeSessions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} align="center" sx={{ py: 4 }}>
                  <Typography color="text.secondary">No active sessions</Typography>
                </TableCell>
              </TableRow>
            ) : (
              activeSessions.map((session) => (
                <TableRow key={session.id}>
                  <TableCell>{session.username || session.email}</TableCell>
                  <TableCell>
                    <Typography variant="body2">{session.connectionName}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {session.connectionHost}:{session.connectionPort}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip label={session.protocol} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell>{session.gatewayName || 'Direct'}</TableCell>
                  <TableCell>
                    <Chip
                      label={session.status}
                      size="small"
                      color={statusColor[session.status] ?? 'default'}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">
                      {new Date(session.startedAt).toLocaleString()}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">
                      {new Date(session.lastActivityAt).toLocaleString()}
                    </Typography>
                  </TableCell>
                  <TableCell>{session.durationFormatted}</TableCell>
                  <TableCell align="right">
                    <Tooltip title="Terminate session">
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() =>
                          setTerminateTarget({
                            id: session.id,
                            label: `${session.username || session.email} - ${session.connectionName}`,
                          })
                        }
                      >
                        <StopIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Terminate confirmation */}
      <Dialog open={Boolean(terminateTarget)} onClose={() => setTerminateTarget(null)}>
        <DialogTitle>Terminate Session</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to terminate the session for <strong>{terminateTarget?.label}</strong>?
            The user&apos;s connection will be dropped immediately.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTerminateTarget(null)}>Cancel</Button>
          <Button onClick={handleTerminate} color="error" variant="contained">
            Terminate
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function MetricCard({ label, value, icon }: { label: string; value: number; icon: React.ReactElement }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, flex: '1 1 160px', minWidth: 160 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
        {icon}
        <Typography variant="caption" color="text.secondary">{label}</Typography>
      </Stack>
      <Typography variant="h4" fontWeight="bold">{value}</Typography>
    </Paper>
  );
}
