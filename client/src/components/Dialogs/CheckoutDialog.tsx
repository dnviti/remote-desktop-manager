import { useState, useEffect, useCallback } from 'react';
import {
  Dialog, AppBar, Toolbar, IconButton, Typography, Box,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Chip, Tabs, Tab, Paper, Tooltip, Alert,
  CircularProgress,
} from '@mui/material';
import {
  Close as CloseIcon,
  CheckCircle as ApproveIcon,
  Cancel as RejectIcon,
  Undo as CheckinIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { SlideUp } from '../common/SlideUp';
import { useCheckoutStore } from '../../store/checkoutStore';
import type { CheckoutRequest, CheckoutStatus } from '../../store/checkoutStore';
import { useAuthStore } from '../../store/authStore';
import { useAsyncAction } from '../../hooks/useAsyncAction';

interface CheckoutDialogProps {
  open: boolean;
  onClose: () => void;
}

const STATUS_COLORS: Record<CheckoutStatus, 'warning' | 'success' | 'error' | 'default' | 'info'> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'error',
  EXPIRED: 'default',
  CHECKED_IN: 'info',
};

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

function useCurrentTime(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}

function TimeRemaining({ expiresAt }: { expiresAt: string | null }) {
  const now = useCurrentTime(15_000);

  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - now;
  if (diff <= 0) return <Chip label="Expired" size="small" color="default" />;
  const mins = Math.floor(diff / 60000);
  return <Chip label={`${formatDuration(mins)} left`} size="small" color="success" variant="outlined" />;
}

export default function CheckoutDialog({ open, onClose }: CheckoutDialogProps) {
  const requests = useCheckoutStore((s) => s.requests);
  const total = useCheckoutStore((s) => s.total);
  const loading = useCheckoutStore((s) => s.loading);
  const fetchRequests = useCheckoutStore((s) => s.fetchRequests);
  const setFilters = useCheckoutStore((s) => s.setFilters);
  const approve = useCheckoutStore((s) => s.approve);
  const reject = useCheckoutStore((s) => s.reject);
  const checkin = useCheckoutStore((s) => s.checkin);
  const currentUserId = useAuthStore((s) => s.user?.id);

  const [tab, setTab] = useState(0);
  const { loading: actionLoading, error: actionError, setError, run } = useAsyncAction();

  const handleTabChange = useCallback((_: unknown, newVal: number) => {
    setTab(newVal);
    const roles: Array<'all' | 'requester' | 'approver'> = ['all', 'requester', 'approver'];
    setFilters({ role: roles[newVal], offset: 0 });
  }, [setFilters]);

  useEffect(() => {
    if (open) {
      fetchRequests();
    }
  }, [open, fetchRequests]);

  // Refetch when filters change
  const filters = useCheckoutStore((s) => s.filters);
  useEffect(() => {
    if (open) {
      fetchRequests();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.role, filters.status]);

  const handleApprove = async (id: string) => {
    await run(async () => { await approve(id); }, 'Failed to approve checkout');
  };

  const handleReject = async (id: string) => {
    await run(async () => { await reject(id); }, 'Failed to reject checkout');
  };

  const handleCheckin = async (id: string) => {
    await run(async () => { await checkin(id); }, 'Failed to check in');
  };

  const canApprove = (req: CheckoutRequest): boolean => {
    return req.status === 'PENDING' && req.requesterId !== currentUserId;
  };

  const canCheckin = (req: CheckoutRequest): boolean => {
    return req.status === 'APPROVED' && (req.requesterId === currentUserId || req.approverId === currentUserId);
  };

  const resourceLabel = (req: CheckoutRequest): string => {
    if (req.secretName) return `Secret: ${req.secretName}`;
    if (req.connectionName) return `Connection: ${req.connectionName}`;
    return req.secretId ? `Secret: ${req.secretId.slice(0, 8)}...` : `Connection: ${req.connectionId?.slice(0, 8)}...`;
  };

  return (
    <Dialog fullScreen open={open} onClose={onClose} TransitionComponent={SlideUp}>
      <AppBar position="static" sx={{ position: 'relative' }}>
        <Toolbar variant="dense">
          <IconButton edge="start" color="inherit" onClick={onClose} aria-label="close">
            <CloseIcon />
          </IconButton>
          <Typography sx={{ ml: 2, flex: 1 }} variant="h6" component="div">
            Credential Check-out
          </Typography>
          <IconButton color="inherit" onClick={fetchRequests} disabled={loading}>
            <RefreshIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', p: 2 }}>
        {actionError && (
          <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>
            {actionError}
          </Alert>
        )}

        <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
          <Tabs value={tab} onChange={handleTabChange}>
            <Tab label={`All (${total})`} />
            <Tab label="My Requests" />
            <Tab label="Pending Approvals" />
          </Tabs>
        </Box>

        {loading && !actionLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : requests.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <Typography color="text.secondary">No checkout requests found</Typography>
          </Box>
        ) : (
          <TableContainer component={Paper} sx={{ flex: 1, overflow: 'auto' }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Resource</TableCell>
                  <TableCell>Requester</TableCell>
                  <TableCell>Duration</TableCell>
                  <TableCell>Reason</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Time Left</TableCell>
                  <TableCell>Requested</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {requests.map((req) => (
                  <TableRow key={req.id} hover>
                    <TableCell>
                      <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                        {resourceLabel(req)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" noWrap>
                        {req.requester.username || req.requester.email}
                      </Typography>
                    </TableCell>
                    <TableCell>{formatDuration(req.durationMinutes)}</TableCell>
                    <TableCell>
                      <Typography variant="body2" noWrap sx={{ maxWidth: 150 }}>
                        {req.reason || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip label={req.status} size="small" color={STATUS_COLORS[req.status]} />
                    </TableCell>
                    <TableCell>
                      {req.status === 'APPROVED' ? <TimeRemaining expiresAt={req.expiresAt} /> : '-'}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">{formatDate(req.createdAt)}</Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {canApprove(req) && (
                        <>
                          <Tooltip title="Approve">
                            <IconButton
                              size="small"
                              color="success"
                              onClick={() => handleApprove(req.id)}
                              disabled={actionLoading}
                            >
                              <ApproveIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Reject">
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => handleReject(req.id)}
                              disabled={actionLoading}
                            >
                              <RejectIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </>
                      )}
                      {canCheckin(req) && (
                        <Tooltip title="Check in (return access)">
                          <IconButton
                            size="small"
                            color="primary"
                            onClick={() => handleCheckin(req.id)}
                            disabled={actionLoading}
                          >
                            <CheckinIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>
    </Dialog>
  );
}
