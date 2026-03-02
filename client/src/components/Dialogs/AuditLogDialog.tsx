import { useState, useEffect, useCallback, forwardRef } from 'react';
import {
  Dialog, AppBar, Toolbar, Typography, Box, IconButton, Card, CardContent,
  Table, TableHead, TableBody, TableRow, TableCell, TablePagination,
  Select, MenuItem, FormControl, InputLabel, TextField, Stack,
  CircularProgress, Chip, Alert, Slide,
} from '@mui/material';
import type { TransitionProps } from '@mui/material/transitions';
import { Close as CloseIcon } from '@mui/icons-material';
import { getAuditLogs, AuditLogEntry, AuditAction, AuditLogParams } from '../../api/audit.api';

const SlideUp = forwardRef(function SlideUp(
  props: TransitionProps & { children: React.ReactElement },
  ref: React.Ref<unknown>,
) {
  return <Slide direction="up" ref={ref} {...props} />;
});

const ACTION_LABELS: Record<AuditAction, string> = {
  LOGIN: 'Login',
  LOGIN_OAUTH: 'OAuth Login',
  LOGIN_TOTP: 'TOTP Login',
  LOGIN_FAILURE: 'Failed Login',
  LOGOUT: 'Logout',
  REGISTER: 'Register',
  LOGIN_SMS: 'SMS Login',
  SMS_MFA_ENABLE: 'SMS MFA Enabled',
  SMS_MFA_DISABLE: 'SMS MFA Disabled',
  SMS_PHONE_VERIFY: 'Phone Verified',
  VAULT_UNLOCK: 'Vault Unlock',
  VAULT_LOCK: 'Vault Lock',
  VAULT_SETUP: 'Vault Setup',
  CREATE_CONNECTION: 'Create Connection',
  UPDATE_CONNECTION: 'Update Connection',
  DELETE_CONNECTION: 'Delete Connection',
  SHARE_CONNECTION: 'Share Connection',
  UNSHARE_CONNECTION: 'Unshare Connection',
  UPDATE_SHARE_PERMISSION: 'Update Share',
  CREATE_FOLDER: 'Create Folder',
  UPDATE_FOLDER: 'Update Folder',
  DELETE_FOLDER: 'Delete Folder',
  PASSWORD_CHANGE: 'Password Change',
  PROFILE_UPDATE: 'Profile Update',
  TOTP_ENABLE: '2FA Enabled',
  TOTP_DISABLE: '2FA Disabled',
  OAUTH_LINK: 'OAuth Link',
  OAUTH_UNLINK: 'OAuth Unlink',
  PASSWORD_REVEAL: 'Password Reveal',
  TENANT_CREATE: 'Create Organization',
  TENANT_UPDATE: 'Update Organization',
  TENANT_DELETE: 'Delete Organization',
  TENANT_INVITE_USER: 'Invite User',
  TENANT_REMOVE_USER: 'Remove User',
  TENANT_UPDATE_USER_ROLE: 'Update User Role',
  TEAM_CREATE: 'Create Team',
  TEAM_UPDATE: 'Update Team',
  TEAM_DELETE: 'Delete Team',
  TEAM_ADD_MEMBER: 'Add Team Member',
  TEAM_REMOVE_MEMBER: 'Remove Team Member',
  TEAM_UPDATE_MEMBER_ROLE: 'Update Member Role',
  EMAIL_TEST_SEND: 'Test Email Sent',
  BATCH_SHARE: 'Batch Share',
  GATEWAY_CREATE: 'Create Gateway',
  GATEWAY_UPDATE: 'Update Gateway',
  GATEWAY_DELETE: 'Delete Gateway',
  SSH_KEY_GENERATE: 'Generate SSH Key',
  SSH_KEY_ROTATE: 'Rotate SSH Key',
  SSH_KEY_PUSH: 'Push SSH Key',
  SSH_KEY_AUTO_ROTATE: 'Auto-Rotate SSH Key',
  SESSION_START: 'Session Start',
  SESSION_END: 'Session End',
  SECRET_CREATE: 'Create Secret',
  SECRET_READ: 'View Secret',
  SECRET_UPDATE: 'Update Secret',
  SECRET_DELETE: 'Delete Secret',
  SECRET_SHARE: 'Share Secret',
  SECRET_UNSHARE: 'Unshare Secret',
  SECRET_EXTERNAL_SHARE: 'External Share Secret',
  SECRET_EXTERNAL_ACCESS: 'External Secret Accessed',
  SECRET_VERSION_RESTORE: 'Restore Secret Version',
  TENANT_VAULT_INIT: 'Initialize Org Vault',
  TENANT_VAULT_KEY_DISTRIBUTE: 'Distribute Vault Key',
};

function getActionColor(action: AuditAction): 'default' | 'primary' | 'secondary' | 'error' | 'warning' | 'success' | 'info' {
  if (['LOGIN', 'LOGIN_OAUTH', 'LOGIN_TOTP', 'LOGIN_SMS', 'REGISTER', 'SESSION_START'].includes(action)) return 'success';
  if (['LOGOUT', 'VAULT_LOCK', 'SECRET_READ', 'SECRET_EXTERNAL_ACCESS', 'SESSION_END'].includes(action)) return 'default';
  if (['LOGIN_FAILURE', 'DELETE_CONNECTION', 'DELETE_FOLDER', 'UNSHARE_CONNECTION', 'SECRET_DELETE', 'SECRET_UNSHARE', 'TENANT_DELETE', 'TEAM_DELETE', 'GATEWAY_DELETE', 'TENANT_REMOVE_USER', 'TEAM_REMOVE_MEMBER'].includes(action)) return 'error';
  if (['PASSWORD_CHANGE', 'PASSWORD_REVEAL', 'TOTP_ENABLE', 'TOTP_DISABLE', 'SMS_MFA_ENABLE', 'SMS_MFA_DISABLE', 'SECRET_EXTERNAL_SHARE', 'SSH_KEY_ROTATE', 'SSH_KEY_AUTO_ROTATE'].includes(action)) return 'warning';
  if (['CREATE_CONNECTION', 'CREATE_FOLDER', 'VAULT_SETUP', 'SECRET_CREATE', 'TENANT_VAULT_INIT', 'TENANT_CREATE', 'TEAM_CREATE', 'GATEWAY_CREATE', 'SSH_KEY_GENERATE'].includes(action)) return 'info';
  return 'primary';
}

function formatDetails(details: Record<string, unknown> | null): string {
  if (!details) return '';
  return Object.entries(details)
    .map(([key, value]) => {
      if (Array.isArray(value)) return `${key}: ${value.join(', ')}`;
      return `${key}: ${value}`;
    })
    .join(' | ');
}

const ALL_ACTIONS: AuditAction[] = [
  'LOGIN', 'LOGIN_OAUTH', 'LOGIN_TOTP', 'LOGIN_SMS', 'LOGIN_FAILURE', 'LOGOUT', 'REGISTER',
  'VAULT_UNLOCK', 'VAULT_LOCK', 'VAULT_SETUP',
  'CREATE_CONNECTION', 'UPDATE_CONNECTION', 'DELETE_CONNECTION',
  'SHARE_CONNECTION', 'UNSHARE_CONNECTION', 'UPDATE_SHARE_PERMISSION', 'BATCH_SHARE',
  'CREATE_FOLDER', 'UPDATE_FOLDER', 'DELETE_FOLDER',
  'PASSWORD_CHANGE', 'PROFILE_UPDATE', 'PASSWORD_REVEAL',
  'TOTP_ENABLE', 'TOTP_DISABLE',
  'SMS_MFA_ENABLE', 'SMS_MFA_DISABLE', 'SMS_PHONE_VERIFY',
  'OAUTH_LINK', 'OAUTH_UNLINK',
  'TENANT_CREATE', 'TENANT_UPDATE', 'TENANT_DELETE',
  'TENANT_INVITE_USER', 'TENANT_REMOVE_USER', 'TENANT_UPDATE_USER_ROLE',
  'TEAM_CREATE', 'TEAM_UPDATE', 'TEAM_DELETE',
  'TEAM_ADD_MEMBER', 'TEAM_REMOVE_MEMBER', 'TEAM_UPDATE_MEMBER_ROLE',
  'GATEWAY_CREATE', 'GATEWAY_UPDATE', 'GATEWAY_DELETE',
  'SSH_KEY_GENERATE', 'SSH_KEY_ROTATE', 'SSH_KEY_PUSH', 'SSH_KEY_AUTO_ROTATE',
  'SESSION_START', 'SESSION_END',
  'SECRET_CREATE', 'SECRET_READ', 'SECRET_UPDATE', 'SECRET_DELETE',
  'SECRET_SHARE', 'SECRET_UNSHARE',
  'SECRET_EXTERNAL_SHARE', 'SECRET_EXTERNAL_ACCESS',
  'SECRET_VERSION_RESTORE',
  'TENANT_VAULT_INIT', 'TENANT_VAULT_KEY_DISTRIBUTE',
  'EMAIL_TEST_SEND',
];

interface AuditLogDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function AuditLogDialog({ open, onClose }: AuditLogDialogProps) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [actionFilter, setActionFilter] = useState<AuditAction | ''>('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: AuditLogParams = {
        page: page + 1,
        limit: rowsPerPage,
      };
      if (actionFilter) params.action = actionFilter;
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
  }, [page, rowsPerPage, actionFilter, startDate, endDate]);

  useEffect(() => {
    if (open) fetchLogs();
  }, [open, fetchLogs]);

  const handleChangePage = (_: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(e.target.value, 10));
    setPage(0);
  };

  const handleFilterChange = () => {
    setPage(0);
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
          <Typography variant="h6">Activity Log</Typography>
        </Toolbar>
      </AppBar>

      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        <Card sx={{ mb: 2 }}>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <InputLabel>Action</InputLabel>
                <Select
                  value={actionFilter}
                  label="Action"
                  onChange={(e) => {
                    setActionFilter(e.target.value as AuditAction | '');
                    handleFilterChange();
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
              <TextField
                size="small"
                type="date"
                label="From"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  handleFilterChange();
                }}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                size="small"
                type="date"
                label="To"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  handleFilterChange();
                }}
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
                {actionFilter || startDate || endDate
                  ? 'No logs match your filters'
                  : 'No activity recorded yet'}
              </Typography>
            </Box>
          ) : (
            <>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Date/Time</TableCell>
                    <TableCell>Action</TableCell>
                    <TableCell>Target</TableCell>
                    <TableCell>IP Address</TableCell>
                    <TableCell>Details</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id} hover>
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
                  ))}
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
