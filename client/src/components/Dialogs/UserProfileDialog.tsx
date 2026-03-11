import { useState, useEffect, useCallback } from 'react';
import {
  Dialog, AppBar, Toolbar, Typography, Box, IconButton, Avatar, Chip, Stack,
  CircularProgress, Alert, Table, TableHead, TableBody, TableRow,
  TableCell, TablePagination, Divider,
} from '@mui/material';
import {
  Close as CloseIcon,
  Shield as ShieldIcon,
  Groups as TeamsIcon,
} from '@mui/icons-material';
import { getUserProfile, UserProfileData } from '../../api/tenant.api';
import { getTenantAuditLogs, TenantAuditLogEntry } from '../../api/audit.api';
import { useAuthStore } from '../../store/authStore';
import { ACTION_LABELS, getActionColor } from '../Audit/auditConstants';
import { SlideUp } from '../common/SlideUp';
import { useAsyncAction } from '../../hooks/useAsyncAction';

interface UserProfileDialogProps {
  open: boolean;
  onClose: () => void;
  userId: string | null;
}

const ROLE_COLORS: Record<string, 'error' | 'warning' | 'primary' | 'default'> = {
  OWNER: 'error',
  ADMIN: 'warning',
  MEMBER: 'primary',
};

export default function UserProfileDialog({ open, onClose, userId }: UserProfileDialogProps) {
  const tenantId = useAuthStore((s) => s.user?.tenantId);

  const [profile, setProfile] = useState<UserProfileData | null>(null);
  const { loading, error, run } = useAsyncAction();

  // Audit log state (admin only)
  const [auditLogs, setAuditLogs] = useState<TenantAuditLogEntry[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);

  const fetchProfile = useCallback(async () => {
    if (!tenantId || !userId) return;
    await run(async () => {
      const data = await getUserProfile(tenantId, userId);
      setProfile(data);
    }, 'Failed to load profile');
  }, [tenantId, userId, run]);

  const fetchAuditLogs = useCallback(async (page: number) => {
    if (!tenantId || !userId || !profile?.email) return;
    setAuditLoading(true);
    try {
      const res = await getTenantAuditLogs({ userId, page: page + 1, limit: 10 });
      setAuditLogs(res.data);
      setAuditTotal(res.total);
    } catch {
      // Silently fail — audit logs are supplementary
    } finally {
      setAuditLoading(false);
    }
  }, [tenantId, userId, profile?.email]);

  useEffect(() => {
    if (open && userId) {
      setProfile(null);
      setAuditLogs([]);
      setAuditPage(0);
      fetchProfile();
    }
  }, [open, userId, fetchProfile]);

  useEffect(() => {
    if (profile?.email) {
      fetchAuditLogs(auditPage);
    }
  }, [profile?.email, auditPage, fetchAuditLogs]);

  const handleAuditPageChange = (_: unknown, newPage: number) => {
    setAuditPage(newPage);
  };

  const isAdmin = !!profile?.email;

  return (
    <Dialog fullScreen open={open} onClose={onClose} TransitionComponent={SlideUp}>
      <AppBar position="static" sx={{ position: 'relative' }}>
        <Toolbar variant="dense">
          <IconButton edge="start" color="inherit" onClick={onClose} aria-label="close">
            <CloseIcon />
          </IconButton>
          <Typography sx={{ ml: 2, flex: 1 }} variant="h6" component="div">
            User Profile
          </Typography>
        </Toolbar>
      </AppBar>

      <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        )}

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {profile && !loading && (
          <Box sx={{ maxWidth: 800, mx: 'auto' }}>
            {/* Public Section */}
            <Stack direction="row" spacing={3} alignItems="center" sx={{ mb: 3 }}>
              <Avatar
                src={profile.avatarData || undefined}
                sx={{ width: 80, height: 80, fontSize: 32 }}
              >
                {(profile.username ?? '?')[0]?.toUpperCase()}
              </Avatar>
              <Box>
                <Typography variant="h5">
                  {profile.username || 'No username'}
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                  <Chip
                    label={profile.role}
                    color={ROLE_COLORS[profile.role] || 'default'}
                    size="small"
                  />
                  <Typography variant="body2" color="text.secondary">
                    Member since {new Date(profile.joinedAt).toLocaleDateString()}
                  </Typography>
                </Stack>
              </Box>
            </Stack>

            {/* Teams */}
            {profile.teams.length > 0 && (
              <Box sx={{ mb: 3 }}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                  <TeamsIcon fontSize="small" color="action" />
                  <Typography variant="subtitle2" color="text.secondary">Teams</Typography>
                </Stack>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {profile.teams.map((t) => (
                    <Chip key={t.id} label={`${t.name} (${t.role})`} variant="outlined" size="small" />
                  ))}
                </Stack>
              </Box>
            )}

            {/* Admin Section */}
            {isAdmin && (
              <>
                <Divider sx={{ my: 3 }} />

                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                  <ShieldIcon fontSize="small" color="action" />
                  <Typography variant="subtitle1" fontWeight={600}>Administration</Typography>
                </Stack>

                <Stack spacing={1.5} sx={{ mb: 3 }}>
                  <Stack direction="row" spacing={2}>
                    <Typography variant="body2" color="text.secondary" sx={{ minWidth: 120 }}>
                      Email
                    </Typography>
                    <Typography variant="body2">{profile.email}</Typography>
                  </Stack>

                  <Stack direction="row" spacing={2}>
                    <Typography variant="body2" color="text.secondary" sx={{ minWidth: 120 }}>
                      MFA Status
                    </Typography>
                    <Stack direction="row" spacing={0.5}>
                      {profile.totpEnabled && <Chip label="TOTP" color="success" size="small" />}
                      {profile.smsMfaEnabled && <Chip label="SMS" color="success" size="small" />}
                      {profile.webauthnEnabled && <Chip label="WebAuthn" color="success" size="small" />}
                      {!profile.totpEnabled && !profile.smsMfaEnabled && !profile.webauthnEnabled && (
                        <Chip label="None" color="default" size="small" />
                      )}
                    </Stack>
                  </Stack>

                  <Stack direction="row" spacing={2}>
                    <Typography variant="body2" color="text.secondary" sx={{ minWidth: 120 }}>
                      Last Activity
                    </Typography>
                    <Typography variant="body2">
                      {profile.lastActivity
                        ? new Date(profile.lastActivity).toLocaleString()
                        : 'No activity recorded'}
                    </Typography>
                  </Stack>

                  {profile.updatedAt && (
                    <Stack direction="row" spacing={2}>
                      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 120 }}>
                        Last Updated
                      </Typography>
                      <Typography variant="body2">
                        {new Date(profile.updatedAt).toLocaleString()}
                      </Typography>
                    </Stack>
                  )}
                </Stack>

                {/* Embedded Audit Log */}
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                  Audit Log
                </Typography>

                <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Date</TableCell>
                        <TableCell>Action</TableCell>
                        <TableCell>IP Address</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {auditLoading && (
                        <TableRow>
                          <TableCell colSpan={3} align="center" sx={{ py: 3 }}>
                            <CircularProgress size={24} />
                          </TableCell>
                        </TableRow>
                      )}
                      {!auditLoading && auditLogs.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={3} align="center" sx={{ py: 3 }}>
                            <Typography variant="body2" color="text.secondary">
                              No audit entries
                            </Typography>
                          </TableCell>
                        </TableRow>
                      )}
                      {!auditLoading && auditLogs.map((log) => (
                        <TableRow key={log.id} hover>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>
                            {new Date(log.createdAt).toLocaleString()}
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={ACTION_LABELS[log.action as keyof typeof ACTION_LABELS] ?? log.action}
                              color={getActionColor(log.action) as 'default'}
                              size="small"
                              variant="outlined"
                            />
                          </TableCell>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                            {log.ipAddress ?? '\u2014'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <TablePagination
                    component="div"
                    count={auditTotal}
                    page={auditPage}
                    onPageChange={handleAuditPageChange}
                    rowsPerPage={10}
                    rowsPerPageOptions={[10]}
                  />
                </Box>
              </>
            )}
          </Box>
        )}
      </Box>
    </Dialog>
  );
}
