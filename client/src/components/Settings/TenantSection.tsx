import { useState, useEffect } from 'react';
import {
  Card, CardContent, Typography, TextField, Button, Stack, Chip, Avatar,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Select, MenuItem, Dialog, DialogTitle, DialogContent, DialogContentText,
  DialogActions, Alert, CircularProgress, Box, IconButton, FormControlLabel, Switch,
  Menu,
} from '@mui/material';
import { PersonAdd, GroupAdd, MoreVert, ContentCopy } from '@mui/icons-material';
import { useAuthStore } from '../../store/authStore';
import { useTenantStore } from '../../store/tenantStore';
import { getTenantMfaStats, adminChangeUserEmail, adminChangeUserPassword } from '../../api/tenant.api';
import { initiateIdentityVerification, type VerificationMethod } from '../../api/user.api';
import InviteDialog from '../Dialogs/InviteDialog';
import CreateUserDialog from '../Dialogs/CreateUserDialog';
import IdentityVerification from '../common/IdentityVerification';
import { extractApiError } from '../../utils/apiError';
import { ALL_ROLES, ROLE_LABELS, isAdminOrAbove, type TenantRole } from '../../utils/roles';

interface TenantSectionProps {
  onNavigateToTab?: (tabId: string) => void;
  onViewUserProfile?: (userId: string) => void;
}

export default function TenantSection({ onNavigateToTab, onViewUserProfile }: TenantSectionProps) {
  const user = useAuthStore((s) => s.user);
  const tenant = useTenantStore((s) => s.tenant);
  const users = useTenantStore((s) => s.users);
  const loading = useTenantStore((s) => s.loading);
  const usersLoading = useTenantStore((s) => s.usersLoading);
  const fetchTenant = useTenantStore((s) => s.fetchTenant);
  const createTenant = useTenantStore((s) => s.createTenant);
  const updateTenant = useTenantStore((s) => s.updateTenant);
  const deleteTenant = useTenantStore((s) => s.deleteTenant);
  const fetchUsers = useTenantStore((s) => s.fetchUsers);
  const updateUserRole = useTenantStore((s) => s.updateUserRole);
  const removeUser = useTenantStore((s) => s.removeUser);
  const toggleUserEnabled = useTenantStore((s) => s.toggleUserEnabled);

  const [editName, setEditName] = useState('');
  const [nameError, setNameError] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState('');
  const [sessionTimeout, setSessionTimeout] = useState('');
  const [savingTimeout, setSavingTimeout] = useState(false);
  const [timeoutError, setTimeoutError] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [savingMfa, setSavingMfa] = useState(false);
  const [mfaError, setMfaError] = useState('');
  const [mfaConfirmOpen, setMfaConfirmOpen] = useState(false);
  const [mfaStats, setMfaStats] = useState<{ total: number; withoutMfa: number } | null>(null);
  const [vaultAutoLockMax, setVaultAutoLockMax] = useState<string>('none');
  const [savingVaultLock, setSavingVaultLock] = useState(false);
  const [vaultLockError, setVaultLockError] = useState('');
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [togglingUser, setTogglingUser] = useState<string | null>(null);

  // Admin action menu
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuTargetUser, setMenuTargetUser] = useState<{ id: string; email: string; name: string } | null>(null);

  // Admin change email dialog
  const [changeEmailOpen, setChangeEmailOpen] = useState(false);
  const [changeEmailTarget, setChangeEmailTarget] = useState<{ id: string; name: string } | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [changeEmailPhase, setChangeEmailPhase] = useState<'input' | 'verifying' | 'done'>('input');
  const [changeEmailVerificationId, setChangeEmailVerificationId] = useState('');
  const [changeEmailMethod, setChangeEmailMethod] = useState<VerificationMethod>('password');
  const [changeEmailMetadata, setChangeEmailMetadata] = useState<Record<string, unknown> | undefined>();
  const [changeEmailLoading, setChangeEmailLoading] = useState(false);
  const [changeEmailError, setChangeEmailError] = useState('');

  // Admin change password dialog
  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [changePwdTarget, setChangePwdTarget] = useState<{ id: string; name: string } | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changePwdPhase, setChangePwdPhase] = useState<'input' | 'verifying' | 'done'>('input');
  const [changePwdVerificationId, setChangePwdVerificationId] = useState('');
  const [changePwdMethod, setChangePwdMethod] = useState<VerificationMethod>('password');
  const [changePwdMetadata, setChangePwdMetadata] = useState<Record<string, unknown> | undefined>();
  const [changePwdLoading, setChangePwdLoading] = useState(false);
  const [changePwdError, setChangePwdError] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');

  const tenantRole = user?.tenantRole;
  const isAdmin = isAdminOrAbove(tenantRole);
  const isOwner = tenantRole === 'OWNER';

  useEffect(() => {
    fetchTenant();
  }, [fetchTenant]);

  useEffect(() => {
    if (tenant) {
      setEditName(tenant.name);
      setSessionTimeout(String(Math.floor(tenant.defaultSessionTimeoutSeconds / 60)));
      setMfaRequired(tenant.mfaRequired);
      setVaultAutoLockMax(tenant.vaultAutoLockMaxMinutes == null ? 'none' : String(tenant.vaultAutoLockMaxMinutes));
      fetchUsers();
    }
  }, [tenant, fetchUsers]);

  const handleSaveName = async () => {
    if (!editName.trim() || editName.trim().length < 2) {
      setNameError('Name must be at least 2 characters');
      return;
    }
    setNameError('');
    setSavingName(true);
    try {
      await updateTenant({ name: editName.trim() });
    } catch (err: unknown) {
      setNameError(extractApiError(err, 'Failed to update name'));
    } finally {
      setSavingName(false);
    }
  };

  const handleSaveTimeout = async () => {
    const minutes = parseInt(sessionTimeout, 10);
    if (isNaN(minutes) || minutes < 1 || minutes > 1440) {
      setTimeoutError('Must be between 1 and 1440 minutes');
      return;
    }
    setTimeoutError('');
    setSavingTimeout(true);
    try {
      await updateTenant({ defaultSessionTimeoutSeconds: minutes * 60 });
    } catch (err: unknown) {
      setTimeoutError(extractApiError(err, 'Failed to update timeout'));
    } finally {
      setSavingTimeout(false);
    }
  };

  const handleMfaToggle = async (enable: boolean) => {
    setMfaError('');
    if (enable) {
      try {
        const stats = await getTenantMfaStats(tenant?.id ?? '');
        setMfaStats(stats);
        setMfaConfirmOpen(true);
      } catch {
        setMfaError('Failed to check MFA status');
      }
    } else {
      setSavingMfa(true);
      try {
        await updateTenant({ mfaRequired: false });
        setMfaRequired(false);
      } catch (err: unknown) {
        setMfaError(extractApiError(err, 'Failed to update MFA policy'));
      } finally {
        setSavingMfa(false);
      }
    }
  };

  const handleConfirmEnableMfa = async () => {
    setMfaConfirmOpen(false);
    setSavingMfa(true);
    setMfaError('');
    try {
      await updateTenant({ mfaRequired: true });
      setMfaRequired(true);
    } catch (err: unknown) {
      setMfaError(extractApiError(err, 'Failed to update MFA policy'));
    } finally {
      setSavingMfa(false);
    }
  };

  const handleCreateTenant = async () => {
    if (!createName.trim() || createName.trim().length < 2) {
      setCreateError('Name must be at least 2 characters');
      return;
    }
    setCreateError('');
    setCreating(true);
    try {
      await createTenant(createName.trim());
    } catch (err: unknown) {
      setCreateError(extractApiError(err, 'Failed to create organization'));
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteTenant = async () => {
    if (deleteConfirmName !== tenant?.name) return;
    setDeleting(true);
    try {
      await deleteTenant();
    } catch (err: unknown) {
      setError(extractApiError(err, 'Failed to delete organization'));
    } finally {
      setDeleting(false);
      setDeleteConfirmOpen(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    setError('');
    try {
      await updateUserRole(userId, newRole as TenantRole);
    } catch (err: unknown) {
      setError(extractApiError(err, 'Failed to update role'));
    }
  };

  const handleToggleEnabled = async (userId: string, enabled: boolean) => {
    setTogglingUser(userId);
    setError('');
    try {
      await toggleUserEnabled(userId, enabled);
    } catch (err: unknown) {
      setError(extractApiError(err, 'Failed to update user status'));
    } finally {
      setTogglingUser(null);
    }
  };

  const handleRemoveUser = async () => {
    if (!removeTarget) return;
    setError('');
    try {
      await removeUser(removeTarget.id);
    } catch (err: unknown) {
      setError(extractApiError(err, 'Failed to remove user'));
    }
    setRemoveTarget(null);
  };

  const openAdminMenu = (event: React.MouseEvent<HTMLElement>, u: { id: string; email: string; username: string | null }) => {
    setMenuAnchor(event.currentTarget);
    setMenuTargetUser({ id: u.id, email: u.email, name: u.username || u.email });
  };

  const closeAdminMenu = () => {
    setMenuAnchor(null);
    setMenuTargetUser(null);
  };

  const openChangeEmail = () => {
    if (!menuTargetUser) return;
    setChangeEmailTarget({ id: menuTargetUser.id, name: menuTargetUser.name });
    setNewEmail('');
    setChangeEmailPhase('input');
    setChangeEmailError('');
    setChangeEmailOpen(true);
    closeAdminMenu();
  };

  const openChangePwd = () => {
    if (!menuTargetUser) return;
    setChangePwdTarget({ id: menuTargetUser.id, name: menuTargetUser.name });
    setNewPassword('');
    setConfirmPassword('');
    setChangePwdPhase('input');
    setChangePwdError('');
    setRecoveryKey('');
    setChangePwdOpen(true);
    closeAdminMenu();
  };

  const handleAdminEmailSubmit = async () => {
    if (!newEmail.trim() || !changeEmailTarget) return;
    setChangeEmailLoading(true);
    setChangeEmailError('');
    try {
      const res = await initiateIdentityVerification('admin-action');
      setChangeEmailVerificationId(res.verificationId);
      setChangeEmailMethod(res.method);
      setChangeEmailMetadata(res.metadata);
      setChangeEmailPhase('verifying');
    } catch (err: unknown) {
      setChangeEmailError(extractApiError(err, 'Failed to initiate verification'));
    } finally {
      setChangeEmailLoading(false);
    }
  };

  const handleAdminEmailVerified = async (verificationId: string) => {
    if (!changeEmailTarget || !tenant) return;
    setChangeEmailLoading(true);
    setChangeEmailError('');
    try {
      await adminChangeUserEmail(tenant.id, changeEmailTarget.id, newEmail.trim(), verificationId);
      setChangeEmailPhase('done');
      fetchUsers();
    } catch (err: unknown) {
      setChangeEmailError(extractApiError(err, 'Failed to change email'));
      setChangeEmailPhase('input');
    } finally {
      setChangeEmailLoading(false);
    }
  };

  const handleAdminPwdSubmit = async () => {
    if (!newPassword || !changePwdTarget) return;
    if (newPassword !== confirmPassword) {
      setChangePwdError('Passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      setChangePwdError('Password must be at least 8 characters');
      return;
    }
    setChangePwdLoading(true);
    setChangePwdError('');
    try {
      const res = await initiateIdentityVerification('admin-action');
      setChangePwdVerificationId(res.verificationId);
      setChangePwdMethod(res.method);
      setChangePwdMetadata(res.metadata);
      setChangePwdPhase('verifying');
    } catch (err: unknown) {
      setChangePwdError(extractApiError(err, 'Failed to initiate verification'));
    } finally {
      setChangePwdLoading(false);
    }
  };

  const handleAdminPwdVerified = async (verificationId: string) => {
    if (!changePwdTarget || !tenant) return;
    setChangePwdLoading(true);
    setChangePwdError('');
    try {
      const res = await adminChangeUserPassword(tenant.id, changePwdTarget.id, newPassword, verificationId);
      setRecoveryKey(res.recoveryKey);
      setChangePwdPhase('done');
    } catch (err: unknown) {
      setChangePwdError(extractApiError(err, 'Failed to change password'));
      setChangePwdPhase('input');
    } finally {
      setChangePwdLoading(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  // Onboarding: no tenant yet
  if (!tenant) {
    return (
      <Box sx={{ maxWidth: 500, mx: 'auto', mt: 2 }}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>Create Your Organization</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Create an organization to collaborate with your team. You can invite members and create teams after setup.
            </Typography>
            {createError && <Alert severity="error" sx={{ mb: 2 }}>{createError}</Alert>}
            <TextField
              label="Organization Name"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              fullWidth
              autoFocus
              inputProps={{ maxLength: 100 }}
              sx={{ mb: 2 }}
            />
            <Button
              variant="contained"
              onClick={handleCreateTenant}
              disabled={creating || !createName.trim()}
              fullWidth
            >
              {creating ? 'Creating...' : 'Create Organization'}
            </Button>
          </CardContent>
        </Card>
      </Box>
    );
  }

  return (
    <>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {/* Organization Info */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Organization Info</Typography>
          <Stack spacing={2}>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-end' }}>
              <TextField
                label="Name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                disabled={!isAdmin}
                fullWidth
                size="small"
                error={!!nameError}
                helperText={nameError}
                inputProps={{ maxLength: 100 }}
              />
              {isAdmin && editName !== tenant.name && (
                <Button variant="contained" size="small" onClick={handleSaveName} disabled={savingName}>
                  {savingName ? 'Saving...' : 'Save'}
                </Button>
              )}
            </Box>
            <TextField
              label="Slug"
              value={tenant.slug}
              disabled
              fullWidth
              size="small"
            />
            <Stack direction="row" spacing={1}>
              <Chip label={`${tenant.userCount} members`} size="small" />
              <Chip label={`${tenant.teamCount} teams`} size="small" />
            </Stack>
            {isAdmin && (
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', mt: 1 }}>
                <TextField
                  label="Default Session Timeout (minutes)"
                  value={sessionTimeout}
                  onChange={(e) => { setSessionTimeout(e.target.value); setTimeoutError(''); }}
                  type="number"
                  size="small"
                  fullWidth
                  error={!!timeoutError}
                  helperText={timeoutError || 'Idle sessions will be closed after this time (1-1440 min)'}
                  inputProps={{ min: 1, max: 1440 }}
                />
                {parseInt(sessionTimeout, 10) * 60 !== tenant.defaultSessionTimeoutSeconds && (
                  <Button variant="contained" size="small" onClick={handleSaveTimeout} disabled={savingTimeout} sx={{ mt: 0.5 }}>
                    {savingTimeout ? 'Saving...' : 'Save'}
                  </Button>
                )}
              </Box>
            )}
          </Stack>

          {isAdmin && (
            <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
              <Typography variant="subtitle2" gutterBottom>Security Policy</Typography>
              {mfaError && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setMfaError('')}>{mfaError}</Alert>}
              <FormControlLabel
                control={
                  <Switch
                    checked={mfaRequired}
                    onChange={(_, checked) => handleMfaToggle(checked)}
                    disabled={savingMfa}
                  />
                }
                label="Require MFA for all members"
              />
              <Typography variant="caption" color="text.secondary" display="block">
                When enabled, members without MFA configured will be required to set it up during their next login.
              </Typography>

              {vaultLockError && <Alert severity="error" sx={{ mt: 1, mb: 1 }} onClose={() => setVaultLockError('')}>{vaultLockError}</Alert>}
              <Box sx={{ mt: 2 }}>
                <Typography variant="body2" sx={{ mb: 0.5 }}>Max vault auto-lock timeout</Typography>
                <Select
                  value={vaultAutoLockMax}
                  size="small"
                  disabled={savingVaultLock}
                  onChange={async (e) => {
                    const val = e.target.value;
                    setVaultLockError('');
                    setSavingVaultLock(true);
                    try {
                      await updateTenant({ vaultAutoLockMaxMinutes: val === 'none' ? null : Number(val) });
                      setVaultAutoLockMax(val);
                    } catch (err: unknown) {
                      setVaultLockError(extractApiError(err, 'Failed to update vault auto-lock policy'));
                    } finally {
                      setSavingVaultLock(false);
                    }
                  }}
                  sx={{ minWidth: 200 }}
                >
                  <MenuItem value="none">No enforcement</MenuItem>
                  <MenuItem value="5">5 minutes</MenuItem>
                  <MenuItem value="15">15 minutes</MenuItem>
                  <MenuItem value="30">30 minutes</MenuItem>
                  <MenuItem value="60">1 hour</MenuItem>
                  <MenuItem value="240">4 hours</MenuItem>
                </Select>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                  When set, members cannot configure a vault auto-lock timeout exceeding this value or disable auto-lock.
                </Typography>
              </Box>
            </Box>
          )}

          {isOwner && (
            <Box sx={{ mt: 3, pt: 2, borderTop: 1, borderColor: 'divider' }}>
              <Button
                color="error"
                variant="outlined"
                size="small"
                onClick={() => setDeleteConfirmOpen(true)}
              >
                Delete Organization
              </Button>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Members */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6" sx={{ flexGrow: 1 }}>Members</Typography>
            {isAdmin && (
              <Stack direction="row" spacing={1}>
                <Button
                  startIcon={<GroupAdd />}
                  variant="contained"
                  size="small"
                  onClick={() => setCreateUserOpen(true)}
                >
                  Create User
                </Button>
                <Button
                  startIcon={<PersonAdd />}
                  variant="outlined"
                  size="small"
                  onClick={() => setInviteOpen(true)}
                >
                  Invite
                </Button>
              </Stack>
            )}
          </Box>
          {usersLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress size={24} />
            </Box>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>User</TableCell>
                    <TableCell>Role</TableCell>
                    <TableCell>MFA</TableCell>
                    {isAdmin && <TableCell>Status</TableCell>}
                    {isAdmin && <TableCell align="right">Actions</TableCell>}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id} sx={u.enabled === false ? { opacity: 0.5 } : undefined}>
                      <TableCell
                        sx={{ cursor: onViewUserProfile ? 'pointer' : undefined }}
                        onClick={() => onViewUserProfile?.(u.id)}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Avatar src={u.avatarData || undefined} sx={{ width: 28, height: 28 }}>
                            {(u.username || u.email).charAt(0).toUpperCase()}
                          </Avatar>
                          <Box>
                            <Typography variant="body2">
                              {u.username || u.email}
                              {u.id === user?.id && (
                                <Typography component="span" variant="caption" color="text.secondary"> (you)</Typography>
                              )}
                            </Typography>
                            {u.username && (
                              <Typography variant="caption" color="text.secondary">{u.email}</Typography>
                            )}
                          </Box>
                        </Box>
                      </TableCell>
                      <TableCell>
                        {isAdmin && u.id !== user?.id ? (
                          <Select
                            value={u.role}
                            size="small"
                            onChange={(e) => handleRoleChange(u.id, e.target.value)}
                            sx={{ minWidth: 110 }}
                          >
                            {ALL_ROLES.map((r) => (
                              <MenuItem key={r} value={r}>{ROLE_LABELS[r]}</MenuItem>
                            ))}
                          </Select>
                        ) : (
                          <Chip label={u.role} size="small" variant="outlined" />
                        )}
                      </TableCell>
                      <TableCell>
                        {u.totpEnabled || u.smsMfaEnabled ? (
                          <Chip label="Active" color="success" size="small" />
                        ) : (
                          <Chip label="None" size="small" />
                        )}
                      </TableCell>
                      {isAdmin && (
                        <TableCell>
                          {u.id === user?.id ? (
                            <Chip label="Active" color="success" size="small" />
                          ) : (
                            <Switch
                              size="small"
                              checked={u.enabled !== false}
                              disabled={togglingUser === u.id}
                              onChange={(_, checked) => handleToggleEnabled(u.id, checked)}
                            />
                          )}
                        </TableCell>
                      )}
                      {isAdmin && (
                        <TableCell align="right">
                          {u.id !== user?.id && (
                            <IconButton
                              size="small"
                              onClick={(e) => openAdminMenu(e, u)}
                            >
                              <MoreVert fontSize="small" />
                            </IconButton>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      {/* Quick Links */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>Teams</Typography>
          <Button variant="outlined" onClick={() => onNavigateToTab?.('teams')}>
            Manage Teams
          </Button>
        </CardContent>
      </Card>

      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
      <CreateUserDialog open={createUserOpen} onClose={() => setCreateUserOpen(false)} />

      {/* Delete org confirmation */}
      <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)}>
        <DialogTitle>Delete Organization</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            This will permanently delete the organization, all teams, and remove all members.
            Type <strong>{tenant.name}</strong> to confirm.
          </DialogContentText>
          <TextField
            fullWidth
            value={deleteConfirmName}
            onChange={(e) => setDeleteConfirmName(e.target.value)}
            placeholder={tenant.name}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setDeleteConfirmOpen(false); setDeleteConfirmName(''); }}>Cancel</Button>
          <Button
            onClick={handleDeleteTenant}
            color="error"
            variant="contained"
            disabled={deleting || deleteConfirmName !== tenant.name}
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Remove user confirmation */}
      <Dialog open={!!removeTarget} onClose={() => setRemoveTarget(null)}>
        <DialogTitle>Remove Member</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to remove <strong>{removeTarget?.name}</strong> from the organization?
            They will also be removed from all teams.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoveTarget(null)}>Cancel</Button>
          <Button onClick={handleRemoveUser} color="error" variant="contained">Remove</Button>
        </DialogActions>
      </Dialog>

      {/* Admin actions menu */}
      <Menu
        anchorEl={menuAnchor}
        open={!!menuAnchor}
        onClose={closeAdminMenu}
      >
        <MenuItem onClick={openChangeEmail}>Change Email</MenuItem>
        <MenuItem onClick={openChangePwd}>Change Password</MenuItem>
        <MenuItem onClick={() => { if (menuTargetUser) { setRemoveTarget({ id: menuTargetUser.id, name: menuTargetUser.name }); closeAdminMenu(); } }} sx={{ color: 'error.main' }}>
          Remove
        </MenuItem>
      </Menu>

      {/* Admin change email dialog */}
      <Dialog open={changeEmailOpen} onClose={() => setChangeEmailOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Change Email — {changeEmailTarget?.name}</DialogTitle>
        <DialogContent>
          {changeEmailError && <Alert severity="error" sx={{ mb: 2 }}>{changeEmailError}</Alert>}
          {changeEmailPhase === 'input' && (
            <>
              <DialogContentText sx={{ mb: 2 }}>
                Enter the new email address for this user. The user&apos;s email will not be verified after the change.
              </DialogContentText>
              <TextField
                label="New Email"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                fullWidth
                autoFocus
              />
            </>
          )}
          {changeEmailPhase === 'verifying' && (
            <>
              <DialogContentText sx={{ mb: 2 }}>
                Verify your identity to proceed.
              </DialogContentText>
              <IdentityVerification
                verificationId={changeEmailVerificationId}
                method={changeEmailMethod}
                metadata={changeEmailMetadata}
                onVerified={handleAdminEmailVerified}
                onCancel={() => setChangeEmailPhase('input')}
              />
            </>
          )}
          {changeEmailPhase === 'done' && (
            <Alert severity="success">
              Email changed successfully to <strong>{newEmail}</strong>.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          {changeEmailPhase === 'input' && (
            <>
              <Button onClick={() => setChangeEmailOpen(false)}>Cancel</Button>
              <Button
                variant="contained"
                onClick={handleAdminEmailSubmit}
                disabled={changeEmailLoading || !newEmail.trim()}
              >
                {changeEmailLoading ? 'Verifying...' : 'Continue'}
              </Button>
            </>
          )}
          {changeEmailPhase === 'done' && (
            <Button onClick={() => setChangeEmailOpen(false)}>Close</Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Admin change password dialog */}
      <Dialog open={changePwdOpen} onClose={() => { if (changePwdPhase !== 'verifying') setChangePwdOpen(false); }} maxWidth="sm" fullWidth>
        <DialogTitle>Change Password — {changePwdTarget?.name}</DialogTitle>
        <DialogContent>
          {changePwdError && <Alert severity="error" sx={{ mb: 2 }}>{changePwdError}</Alert>}
          {changePwdPhase === 'input' && (
            <>
              <DialogContentText sx={{ mb: 2 }}>
                Set a new password for this user. This will reset their vault — all stored credentials will be lost.
              </DialogContentText>
              <Stack spacing={2}>
                <TextField
                  label="New Password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  fullWidth
                  autoFocus
                />
                <TextField
                  label="Confirm Password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  fullWidth
                />
              </Stack>
            </>
          )}
          {changePwdPhase === 'verifying' && (
            <>
              <DialogContentText sx={{ mb: 2 }}>
                Verify your identity to proceed.
              </DialogContentText>
              <IdentityVerification
                verificationId={changePwdVerificationId}
                method={changePwdMethod}
                metadata={changePwdMetadata}
                onVerified={handleAdminPwdVerified}
                onCancel={() => setChangePwdPhase('input')}
              />
            </>
          )}
          {changePwdPhase === 'done' && (
            <>
              <Alert severity="success" sx={{ mb: 2 }}>
                Password changed successfully.
              </Alert>
              <Alert severity="warning" sx={{ mb: 2 }}>
                The user&apos;s vault has been reset. Save the recovery key below — it will not be shown again.
              </Alert>
              <TextField
                label="Recovery Key"
                value={recoveryKey}
                fullWidth
                slotProps={{ input: { readOnly: true } }}
                sx={{ fontFamily: 'monospace' }}
              />
              <Button
                size="small"
                startIcon={<ContentCopy />}
                onClick={() => navigator.clipboard.writeText(recoveryKey)}
                sx={{ mt: 1 }}
              >
                Copy Recovery Key
              </Button>
            </>
          )}
        </DialogContent>
        <DialogActions>
          {changePwdPhase === 'input' && (
            <>
              <Button onClick={() => setChangePwdOpen(false)}>Cancel</Button>
              <Button
                variant="contained"
                onClick={handleAdminPwdSubmit}
                disabled={changePwdLoading || !newPassword || !confirmPassword}
              >
                {changePwdLoading ? 'Verifying...' : 'Continue'}
              </Button>
            </>
          )}
          {changePwdPhase === 'done' && (
            <Button onClick={() => setChangePwdOpen(false)}>Close</Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Confirm enable mandatory MFA */}
      <Dialog open={mfaConfirmOpen} onClose={() => setMfaConfirmOpen(false)}>
        <DialogTitle>Enable Mandatory MFA</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {mfaStats && mfaStats.withoutMfa > 0 ? (
              <>
                <strong>{mfaStats.withoutMfa}</strong> of {mfaStats.total} members do not have MFA configured.
                They will be required to set up MFA during their next login.
              </>
            ) : (
              'All members already have MFA configured. Enabling this policy will ensure future members also set up MFA.'
            )}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMfaConfirmOpen(false)}>Cancel</Button>
          <Button onClick={handleConfirmEnableMfa} variant="contained">
            Enable Mandatory MFA
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
