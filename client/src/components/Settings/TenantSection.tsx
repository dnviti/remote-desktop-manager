import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuthStore } from '../../store/authStore';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';
import { useNotificationStore } from '../../store/notificationStore';
import { useTenantStore } from '../../store/tenantStore';
import {
  adminChangeUserEmail,
  adminChangeUserPassword,
  getTenantMfaStats,
  type TenantUser,
} from '../../api/tenant.api';
import { initiateIdentityVerification, type VerificationMethod } from '../../api/user.api';
import { extractApiError } from '../../utils/apiError';
import { isAdminOrAbove } from '../../utils/roles';
import CreateUserDialog from '../Dialogs/CreateUserDialog';
import InviteDialog from '../Dialogs/InviteDialog';
import PermissionOverridesDialog from './PermissionOverridesDialog';
import {
  SettingsFieldCard,
  SettingsFieldGroup,
  SettingsPanel,
  SettingsSectionBlock,
  SettingsSummaryGrid,
  SettingsSummaryItem,
  SettingsSwitchRow,
} from './settings-ui';
import TenantMembersPanel from './tenantSectionMembers';
import {
  ChangeUserEmailDialog,
  ChangeUserPasswordDialog,
  DeleteTenantDialog,
  MandatoryMfaDialog,
  MembershipExpiryDialog,
  RemoveMemberDialog,
  type TenantDialogTarget,
  type TenantExpiryTarget,
} from './tenantSectionDialogs';
import { TenantInlineSaveField, TenantPolicySelectField } from './tenantSectionFields';
import {
  absoluteSessionTimeoutOptions,
  accessTokenExpiryOptions,
  accountLockoutDurationOptions,
  impossibleTravelSpeedOptions,
  loginAttemptOptions,
  loginRateLimitWindowOptions,
  maxConcurrentSessionOptions,
  refreshTokenExpiryOptions,
  vaultAutoLockOptions,
  vaultDefaultTtlOptions,
} from './tenantSectionOptions';
import {
  formatMegabytes,
  parseRecordingRetentionPatch,
  parseSessionTimeoutPatch,
  parseUserDriveQuotaPatch,
} from './tenantPolicyValues';

interface TenantSectionProps {
  onDeleteRequest?: (trigger: (() => void) | null) => void;
  onViewUserProfile?: (userId: string) => void;
}

type TenantUpdateInput = Parameters<ReturnType<typeof useTenantStore.getState>['updateTenant']>[0];

function getMemberTarget(user: TenantUser): TenantDialogTarget {
  return {
    id: user.id,
    name: user.username || user.email,
  };
}

export default function TenantSection({ onDeleteRequest, onViewUserProfile }: TenantSectionProps) {
  const user = useAuthStore((state) => state.user);
  const tenant = useTenantStore((state) => state.tenant);
  const users = useTenantStore((state) => state.users);
  const loading = useTenantStore((state) => state.loading);
  const usersLoading = useTenantStore((state) => state.usersLoading);
  const fetchTenant = useTenantStore((state) => state.fetchTenant);
  const createTenant = useTenantStore((state) => state.createTenant);
  const updateTenant = useTenantStore((state) => state.updateTenant);
  const deleteTenant = useTenantStore((state) => state.deleteTenant);
  const fetchUsers = useTenantStore((state) => state.fetchUsers);
  const updateUserRole = useTenantStore((state) => state.updateUserRole);
  const removeUser = useTenantStore((state) => state.removeUser);
  const toggleUserEnabled = useTenantStore((state) => state.toggleUserEnabled);
  const updateMembershipExpiry = useTenantStore((state) => state.updateMembershipExpiry);
  const notify = useNotificationStore((state) => state.notify);

  const multiTenancyEnabled = useFeatureFlagsStore((state) => state.multiTenancyEnabled);
  const recordingsFeatureEnabled = useFeatureFlagsStore((state) => state.recordingsEnabled);
  const tenantRole = user?.tenantRole;
  const isAdmin = isAdminOrAbove(tenantRole);

  const [error, setError] = useState('');
  const [createName, setCreateName] = useState('');
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);
  const [editName, setEditName] = useState('');
  const [nameError, setNameError] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [togglingUser, setTogglingUser] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<TenantDialogTarget | null>(null);
  const [permDialogOpen, setPermDialogOpen] = useState(false);
  const [permTarget, setPermTarget] = useState<TenantDialogTarget | null>(null);
  const [expiryDialogOpen, setExpiryDialogOpen] = useState(false);
  const [expiryTarget, setExpiryTarget] = useState<TenantExpiryTarget | null>(null);
  const [expiryValue, setExpiryValue] = useState('');
  const [savingExpiry, setSavingExpiry] = useState(false);

  const [sessionTimeout, setSessionTimeout] = useState('');
  const [timeoutError, setTimeoutError] = useState('');
  const [savingTimeout, setSavingTimeout] = useState(false);

  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaError, setMfaError] = useState('');
  const [savingMfa, setSavingMfa] = useState(false);
  const [mfaConfirmOpen, setMfaConfirmOpen] = useState(false);
  const [mfaStats, setMfaStats] = useState<{ total: number; withoutMfa: number } | null>(null);
  const [mfaDashboard, setMfaDashboard] = useState<{ total: number; withoutMfa: number } | null>(null);

  const [vaultAutoLockMax, setVaultAutoLockMax] = useState('none');
  const [vaultLockError, setVaultLockError] = useState('');
  const [savingVaultLock, setSavingVaultLock] = useState(false);
  const [maxConcurrentSessions, setMaxConcurrentSessions] = useState('0');
  const [concurrentSessionsError, setConcurrentSessionsError] = useState('');
  const [savingConcurrentSessions, setSavingConcurrentSessions] = useState(false);
  const [absoluteSessionTimeout, setAbsoluteSessionTimeout] = useState('43200');
  const [absoluteTimeoutError, setAbsoluteTimeoutError] = useState('');
  const [savingAbsoluteTimeout, setSavingAbsoluteTimeout] = useState(false);

  const [loginRateLimitWindow, setLoginRateLimitWindow] = useState('default');
  const [rateLimitWindowError, setRateLimitWindowError] = useState('');
  const [savingRateLimitWindow, setSavingRateLimitWindow] = useState(false);
  const [loginRateLimitMaxAttempts, setLoginRateLimitMaxAttempts] = useState('default');
  const [rateLimitMaxAttemptsError, setRateLimitMaxAttemptsError] = useState('');
  const [savingRateLimitMaxAttempts, setSavingRateLimitMaxAttempts] = useState(false);
  const [accountLockoutThreshold, setAccountLockoutThreshold] = useState('default');
  const [lockoutThresholdError, setLockoutThresholdError] = useState('');
  const [savingLockoutThreshold, setSavingLockoutThreshold] = useState(false);
  const [accountLockoutDuration, setAccountLockoutDuration] = useState('default');
  const [lockoutDurationError, setLockoutDurationError] = useState('');
  const [savingLockoutDuration, setSavingLockoutDuration] = useState(false);
  const [impossibleTravelSpeed, setImpossibleTravelSpeed] = useState('default');
  const [travelSpeedError, setTravelSpeedError] = useState('');
  const [savingTravelSpeed, setSavingTravelSpeed] = useState(false);

  const [jwtExpiresIn, setJwtExpiresIn] = useState('default');
  const [jwtExpiresError, setJwtExpiresError] = useState('');
  const [savingJwtExpires, setSavingJwtExpires] = useState(false);
  const [jwtRefreshExpiresIn, setJwtRefreshExpiresIn] = useState('default');
  const [jwtRefreshExpiresError, setJwtRefreshExpiresError] = useState('');
  const [savingJwtRefreshExpires, setSavingJwtRefreshExpires] = useState(false);
  const [vaultDefaultTtl, setVaultDefaultTtl] = useState('default');
  const [vaultDefaultTtlError, setVaultDefaultTtlError] = useState('');
  const [savingVaultDefaultTtl, setSavingVaultDefaultTtl] = useState(false);

  const [dlpDisableCopy, setDlpDisableCopy] = useState(false);
  const [dlpDisablePaste, setDlpDisablePaste] = useState(false);
  const [dlpDisableDownload, setDlpDisableDownload] = useState(false);
  const [dlpDisableUpload, setDlpDisableUpload] = useState(false);
  const [dlpError, setDlpError] = useState('');
  const [savingDlp, setSavingDlp] = useState(false);

  const [recordingEnabled, setRecordingEnabled] = useState(true);
  const [recordingError, setRecordingError] = useState('');
  const [savingRecording, setSavingRecording] = useState(false);
  const [recordingRetentionDays, setRecordingRetentionDays] = useState('');
  const [retentionError, setRetentionError] = useState('');
  const [savingRetention, setSavingRetention] = useState(false);

  const [userDriveQuotaMb, setUserDriveQuotaMb] = useState('');
  const [storageError, setStorageError] = useState('');
  const [savingStorage, setSavingStorage] = useState(false);

  const [changeEmailOpen, setChangeEmailOpen] = useState(false);
  const [changeEmailTarget, setChangeEmailTarget] = useState<TenantDialogTarget | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [changeEmailPhase, setChangeEmailPhase] = useState<'input' | 'verifying' | 'done'>('input');
  const [changeEmailVerificationId, setChangeEmailVerificationId] = useState('');
  const [changeEmailMethod, setChangeEmailMethod] = useState<VerificationMethod>('password');
  const [changeEmailMetadata, setChangeEmailMetadata] = useState<Record<string, unknown> | undefined>();
  const [changeEmailLoading, setChangeEmailLoading] = useState(false);
  const [changeEmailError, setChangeEmailError] = useState('');

  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [changePwdTarget, setChangePwdTarget] = useState<TenantDialogTarget | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changePwdPhase, setChangePwdPhase] = useState<'input' | 'verifying' | 'done'>('input');
  const [changePwdVerificationId, setChangePwdVerificationId] = useState('');
  const [changePwdMethod, setChangePwdMethod] = useState<VerificationMethod>('password');
  const [changePwdMetadata, setChangePwdMetadata] = useState<Record<string, unknown> | undefined>();
  const [changePwdLoading, setChangePwdLoading] = useState(false);
  const [changePwdError, setChangePwdError] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const openDeleteConfirm = useCallback(() => {
    setDeleteConfirmOpen(true);
  }, []);

  useEffect(() => {
    void fetchTenant();
  }, [fetchTenant]);

  useEffect(() => {
    onDeleteRequest?.(openDeleteConfirm);
  }, [onDeleteRequest, openDeleteConfirm]);

  useEffect(() => {
    if (!tenant) return;

    setEditName(tenant.name);
    setSessionTimeout(String(Math.floor(tenant.defaultSessionTimeoutSeconds / 60)));
    setMfaRequired(tenant.mfaRequired);
    setVaultAutoLockMax(tenant.vaultAutoLockMaxMinutes == null ? 'none' : String(tenant.vaultAutoLockMaxMinutes));
    setMaxConcurrentSessions(String(tenant.maxConcurrentSessions));
    setAbsoluteSessionTimeout(String(tenant.absoluteSessionTimeoutSeconds));
    setLoginRateLimitWindow(tenant.loginRateLimitWindowMs == null ? 'default' : String(tenant.loginRateLimitWindowMs));
    setLoginRateLimitMaxAttempts(tenant.loginRateLimitMaxAttempts == null ? 'default' : String(tenant.loginRateLimitMaxAttempts));
    setAccountLockoutThreshold(tenant.accountLockoutThreshold == null ? 'default' : String(tenant.accountLockoutThreshold));
    setAccountLockoutDuration(tenant.accountLockoutDurationMs == null ? 'default' : String(tenant.accountLockoutDurationMs));
    setImpossibleTravelSpeed(tenant.impossibleTravelSpeedKmh == null ? 'default' : String(tenant.impossibleTravelSpeedKmh));
    setJwtExpiresIn(tenant.jwtExpiresInSeconds == null ? 'default' : String(tenant.jwtExpiresInSeconds));
    setJwtRefreshExpiresIn(tenant.jwtRefreshExpiresInSeconds == null ? 'default' : String(tenant.jwtRefreshExpiresInSeconds));
    setVaultDefaultTtl(tenant.vaultDefaultTtlMinutes == null ? 'default' : String(tenant.vaultDefaultTtlMinutes));
    setDlpDisableCopy(tenant.dlpDisableCopy);
    setDlpDisablePaste(tenant.dlpDisablePaste);
    setDlpDisableDownload(tenant.dlpDisableDownload);
    setDlpDisableUpload(tenant.dlpDisableUpload);
    setRecordingEnabled(tenant.recordingEnabled);
    setRecordingRetentionDays(tenant.recordingRetentionDays != null ? String(tenant.recordingRetentionDays) : '');
    setUserDriveQuotaMb(tenant.userDriveQuotaBytes != null ? String(parseFloat((tenant.userDriveQuotaBytes / 1048576).toFixed(2))) : '');

    void fetchUsers();
    if (isAdmin) {
      getTenantMfaStats(tenant.id).then(setMfaDashboard).catch(() => {});
    }
  }, [fetchUsers, isAdmin, tenant]);

  const saveTenantPatch = async ({
    fallbackMessage,
    onSuccess,
    patch,
    setError,
    setSaving,
  }: {
    fallbackMessage: string;
    onSuccess?: () => void;
    patch: TenantUpdateInput;
    setError: (value: string) => void;
    setSaving: (value: boolean) => void;
  }) => {
    setError('');
    setSaving(true);
    try {
      await updateTenant(patch);
      onSuccess?.();
    } catch (err: unknown) {
      setError(extractApiError(err, fallbackMessage));
    } finally {
      setSaving(false);
    }
  };

  const handleCreateTenant = async () => {
    if (!createName.trim() || createName.trim().length < 2) {
      setCreateError('Name must be at least 2 characters.');
      return;
    }

    setCreateError('');
    setCreating(true);
    try {
      await createTenant(createName.trim());
    } catch (err: unknown) {
      setCreateError(extractApiError(err, 'Failed to create organization.'));
    } finally {
      setCreating(false);
    }
  };

  const handleSaveName = async () => {
    if (!tenant) return;
    if (!editName.trim() || editName.trim().length < 2) {
      setNameError('Name must be at least 2 characters.');
      return;
    }

    await saveTenantPatch({
      patch: { name: editName.trim() },
      setSaving: setSavingName,
      setError: setNameError,
      fallbackMessage: 'Failed to update organization name.',
    });
  };

  const handleSaveTimeout = async () => {
    const result = parseSessionTimeoutPatch(sessionTimeout);
    if (result.error || !result.patch) {
      setTimeoutError(result.error ?? 'Invalid session timeout.');
      return;
    }

    await saveTenantPatch({
      patch: result.patch,
      setSaving: setSavingTimeout,
      setError: setTimeoutError,
      fallbackMessage: 'Failed to update session timeout.',
    });
  };

  const handleDeleteTenant = async () => {
    if (deleteConfirmName !== tenant?.name) return;
    setDeleting(true);
    try {
      await deleteTenant();
      setDeleteConfirmOpen(false);
      setDeleteConfirmName('');
    } catch (err: unknown) {
      setError(extractApiError(err, 'Failed to delete organization.'));
    } finally {
      setDeleting(false);
    }
  };

  const handleRoleChange = async (userId: string, role: string) => {
    setError('');
    try {
      await updateUserRole(userId, role as Parameters<typeof updateUserRole>[1]);
    } catch (err: unknown) {
      setError(extractApiError(err, 'Failed to update role.'));
    }
  };

  const handleToggleEnabled = async (userId: string, enabled: boolean) => {
    setTogglingUser(userId);
    setError('');
    try {
      await toggleUserEnabled(userId, enabled);
    } catch (err: unknown) {
      setError(extractApiError(err, 'Failed to update member status.'));
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
      setError(extractApiError(err, 'Failed to remove member.'));
    } finally {
      setRemoveTarget(null);
    }
  };

  const openPermissionOverrides = (member: TenantUser) => {
    setPermTarget(getMemberTarget(member));
    setPermDialogOpen(true);
  };

  const openExpiryDialog = (member: TenantUser) => {
    setExpiryTarget({
      ...getMemberTarget(member),
      expiresAt: member.expiresAt,
    });
    setExpiryValue(member.expiresAt ? new Date(member.expiresAt).toISOString().slice(0, 16) : '');
    setExpiryDialogOpen(true);
  };

  const openChangeEmail = (member: TenantUser) => {
    setChangeEmailTarget(getMemberTarget(member));
    setChangeEmailOpen(true);
    setNewEmail('');
    setChangeEmailPhase('input');
    setChangeEmailError('');
  };

  const openChangePassword = (member: TenantUser) => {
    setChangePwdTarget(getMemberTarget(member));
    setChangePwdOpen(true);
    setNewPassword('');
    setConfirmPassword('');
    setChangePwdPhase('input');
    setChangePwdError('');
    setRecoveryKey('');
  };

  const handleMfaToggle = async (checked: boolean) => {
    if (!tenant) return;
    if (checked) {
      try {
        const stats = await getTenantMfaStats(tenant.id);
        setMfaStats(stats);
        setMfaConfirmOpen(true);
      } catch {
        setMfaError('Failed to check MFA adoption.');
      }
      return;
    }

    await saveTenantPatch({
      patch: { mfaRequired: false },
      setSaving: setSavingMfa,
      setError: setMfaError,
      fallbackMessage: 'Failed to update MFA policy.',
      onSuccess: () => setMfaRequired(false),
    });
  };

  const handleConfirmEnableMfa = async () => {
    setMfaConfirmOpen(false);
    await saveTenantPatch({
      patch: { mfaRequired: true },
      setSaving: setSavingMfa,
      setError: setMfaError,
      fallbackMessage: 'Failed to update MFA policy.',
      onSuccess: () => setMfaRequired(true),
    });
  };

  const handleSaveRetention = async () => {
    const result = parseRecordingRetentionPatch(recordingRetentionDays);
    if (result.error || !result.patch) {
      setRetentionError(result.error ?? 'Invalid retention policy.');
      return;
    }

    await saveTenantPatch({
      patch: result.patch,
      setSaving: setSavingRetention,
      setError: setRetentionError,
      fallbackMessage: 'Failed to update retention policy.',
    });
  };

  const handleSaveStorage = async () => {
    const result = parseUserDriveQuotaPatch(userDriveQuotaMb);
    if (result.error || !result.patch) {
      setStorageError(result.error ?? 'Invalid storage policy.');
      return;
    }

    await saveTenantPatch({
      patch: result.patch,
      setSaving: setSavingStorage,
      setError: setStorageError,
      fallbackMessage: 'Failed to update storage policy.',
    });
  };

  const handleSaveExpiry = async () => {
    if (!expiryTarget || !expiryValue) return;
    setSavingExpiry(true);
    try {
      await updateMembershipExpiry(expiryTarget.id, new Date(expiryValue).toISOString());
      setExpiryDialogOpen(false);
    } catch (err: unknown) {
      setError(extractApiError(err, 'Failed to update membership expiration.'));
    } finally {
      setSavingExpiry(false);
    }
  };

  const handleRemoveExpiry = async () => {
    if (!expiryTarget) return;
    setSavingExpiry(true);
    try {
      await updateMembershipExpiry(expiryTarget.id, null);
      setExpiryDialogOpen(false);
    } catch (err: unknown) {
      setError(extractApiError(err, 'Failed to remove membership expiration.'));
    } finally {
      setSavingExpiry(false);
    }
  };

  const handleAdminEmailSubmit = async () => {
    if (!newEmail.trim()) return;
    setChangeEmailLoading(true);
    setChangeEmailError('');
    try {
      const result = await initiateIdentityVerification('admin-action');
      setChangeEmailVerificationId(result.verificationId);
      setChangeEmailMethod(result.method);
      setChangeEmailMetadata(result.metadata);
      setChangeEmailPhase('verifying');
    } catch (err: unknown) {
      setChangeEmailError(extractApiError(err, 'Failed to initiate verification.'));
    } finally {
      setChangeEmailLoading(false);
    }
  };

  const handleAdminEmailVerified = async (verificationId: string) => {
    if (!tenant || !changeEmailTarget) return;
    setChangeEmailLoading(true);
    setChangeEmailError('');
    try {
      await adminChangeUserEmail(tenant.id, changeEmailTarget.id, newEmail.trim(), verificationId);
      notify(`Email changed successfully to ${newEmail.trim()}`, 'success');
      setChangeEmailOpen(false);
      void fetchUsers();
    } catch (err: unknown) {
      setChangeEmailError(extractApiError(err, 'Failed to change email.'));
      setChangeEmailPhase('input');
    } finally {
      setChangeEmailLoading(false);
    }
  };

  const handleAdminPasswordSubmit = async () => {
    if (!changePwdTarget) return;
    if (newPassword !== confirmPassword) {
      setChangePwdError('Passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setChangePwdError('Password must be at least 8 characters.');
      return;
    }

    setChangePwdLoading(true);
    setChangePwdError('');
    try {
      const result = await initiateIdentityVerification('admin-action');
      setChangePwdVerificationId(result.verificationId);
      setChangePwdMethod(result.method);
      setChangePwdMetadata(result.metadata);
      setChangePwdPhase('verifying');
    } catch (err: unknown) {
      setChangePwdError(extractApiError(err, 'Failed to initiate verification.'));
    } finally {
      setChangePwdLoading(false);
    }
  };

  const handleAdminPasswordVerified = async (verificationId: string) => {
    if (!tenant || !changePwdTarget) return;
    setChangePwdLoading(true);
    setChangePwdError('');
    try {
      const result = await adminChangeUserPassword(tenant.id, changePwdTarget.id, newPassword, verificationId);
      setRecoveryKey(result.recoveryKey);
      setChangePwdPhase('done');
      notify('Password changed successfully', 'success');
    } catch (err: unknown) {
      setChangePwdError(extractApiError(err, 'Failed to change password.'));
      setChangePwdPhase('input');
    } finally {
      setChangePwdLoading(false);
    }
  };

  if (loading) {
    return (
      <SettingsPanel title="Organization" description="Loading organization settings...">
        <div className="py-6 text-sm text-muted-foreground">Loading organization settings...</div>
      </SettingsPanel>
    );
  }

  if (!tenant) {
    return (
      <SettingsPanel
        title={multiTenancyEnabled ? 'Create Your Organization' : 'Organization Required'}
        description={
          multiTenancyEnabled
            ? 'Create a shared workspace before teams, policies, and infrastructure settings become available.'
            : 'This deployment is running in single-tenant mode. An administrator must provision the workspace organization.'
        }
        contentClassName="space-y-4"
      >
        {createError ? (
          <Alert variant="destructive">
            <AlertDescription>{createError}</AlertDescription>
          </Alert>
        ) : null}
        {multiTenancyEnabled ? (
          <div className="max-w-lg space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tenant-create-name">Organization name</Label>
              <Input
                id="tenant-create-name"
                autoFocus
                value={createName}
                maxLength={100}
                onChange={(event) => setCreateName(event.target.value)}
              />
            </div>
            <Button type="button" onClick={handleCreateTenant} disabled={creating || !createName.trim()}>
              {creating ? 'Creating...' : 'Create Organization'}
            </Button>
          </div>
        ) : (
          <Alert>
            <AlertTriangle className="size-4" />
            <AlertDescription>
              Single-tenant deployments must be provisioned during setup rather than from the end-user UI.
            </AlertDescription>
          </Alert>
        )}
      </SettingsPanel>
    );
  }

  return (
    <>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <SettingsPanel
        title="Organization"
        description="Workspace identity, baseline session behavior, and organization-level controls."
        contentClassName="space-y-5"
      >
        <SettingsSummaryGrid>
          <SettingsSummaryItem label="Slug" value={tenant.slug} />
          <SettingsSummaryItem label="Members" value={tenant.userCount} />
          <SettingsSummaryItem label="Teams" value={tenant.teamCount} />
          <SettingsSummaryItem label="Default Session Timeout" value={`${Math.floor(tenant.defaultSessionTimeoutSeconds / 60)} min`} />
        </SettingsSummaryGrid>

        <SettingsSectionBlock
          title="Workspace identity"
          description="Keep the organization name stable and recognizable. The slug is derived and read-only."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <TenantInlineSaveField
              label="Organization name"
              description="Visible across invitations, settings, and audit surfaces."
              value={editName}
              saving={savingName}
              error={nameError}
              onChange={(value) => {
                setEditName(value);
                setNameError('');
              }}
              onSave={handleSaveName}
              inputProps={{ maxLength: 100 }}
            />
            <SettingsFieldCard
              label="Slug"
              description="Stable identifier used in APIs and tenant routing."
            >
              <Input readOnly value={tenant.slug} />
            </SettingsFieldCard>
          </div>

          {isAdmin ? (
            <TenantInlineSaveField
              label="Default session timeout (minutes)"
              description="Idle sessions are closed after this much inactivity."
              value={sessionTimeout}
              saving={savingTimeout}
              error={timeoutError}
              onChange={(value) => {
                setSessionTimeout(value);
                setTimeoutError('');
              }}
              onSave={handleSaveTimeout}
              type="number"
              helperText="Choose a value between 1 and 1440 minutes."
              inputProps={{ min: 1, max: 1440 }}
            />
          ) : null}
        </SettingsSectionBlock>
      </SettingsPanel>

      <TenantMembersPanel
        currentUserId={user?.id}
        isAdmin={isAdmin}
        loading={usersLoading}
        users={users}
        togglingUserId={togglingUser}
        onViewUserProfile={onViewUserProfile}
        onCreateUser={() => setCreateUserOpen(true)}
        onInvite={() => setInviteOpen(true)}
        onRoleChange={handleRoleChange}
        onToggleEnabled={handleToggleEnabled}
        onEditPermissions={openPermissionOverrides}
        onEditExpiry={openExpiryDialog}
        onChangeEmail={openChangeEmail}
        onChangePassword={openChangePassword}
        onRemove={(member) => setRemoveTarget(getMemberTarget(member))}
      />

      {isAdmin ? (
        <SettingsPanel
          title="Security & Session Policy"
          description="Tenant-wide controls for authentication, lifetime management, storage, and data handling."
          contentClassName="space-y-5"
        >
          {mfaDashboard ? (
            <SettingsSummaryGrid>
              <SettingsSummaryItem label="MFA Enabled" value={`${mfaDashboard.total - mfaDashboard.withoutMfa} / ${mfaDashboard.total} users`} />
              <SettingsSummaryItem label="Members Without MFA" value={mfaDashboard.withoutMfa} />
              <SettingsSummaryItem label="User Drive Quota" value={formatMegabytes(tenant.userDriveQuotaBytes)} />
            </SettingsSummaryGrid>
          ) : null}

          <SettingsFieldGroup>
            <SettingsSectionBlock
              title="Identity & access"
              description="Baseline requirements for MFA, vault behavior, and hard session limits."
            >
              {mfaError ? (
                <Alert variant="destructive">
                  <AlertDescription>{mfaError}</AlertDescription>
                </Alert>
              ) : null}
              <SettingsSwitchRow
                title="Require MFA for every member"
                description="Members without MFA configured are forced through setup on their next login."
                checked={mfaRequired}
                disabled={savingMfa}
                onCheckedChange={(checked) => { void handleMfaToggle(checked); }}
              />
              <TenantPolicySelectField
                label="Max vault auto-lock timeout"
                description="Members cannot disable auto-lock or choose a longer timeout than this."
                value={vaultAutoLockMax}
                saving={savingVaultLock}
                error={vaultLockError}
                options={vaultAutoLockOptions}
                onValueChange={(value) => {
                  void saveTenantPatch({
                    patch: { vaultAutoLockMaxMinutes: value === 'none' ? null : Number(value) },
                    setSaving: setSavingVaultLock,
                    setError: setVaultLockError,
                    fallbackMessage: 'Failed to update vault auto-lock policy.',
                    onSuccess: () => setVaultAutoLockMax(value),
                  });
                }}
              />
              <TenantPolicySelectField
                label="Max concurrent sessions per user"
                description="When the limit is exceeded, the oldest session is terminated automatically."
                value={maxConcurrentSessions}
                saving={savingConcurrentSessions}
                error={concurrentSessionsError}
                options={maxConcurrentSessionOptions}
                onValueChange={(value) => {
                  void saveTenantPatch({
                    patch: { maxConcurrentSessions: Number(value) },
                    setSaving: setSavingConcurrentSessions,
                    setError: setConcurrentSessionsError,
                    fallbackMessage: 'Failed to update concurrent session limit.',
                    onSuccess: () => setMaxConcurrentSessions(value),
                  });
                }}
              />
              <TenantPolicySelectField
                label="Absolute session timeout"
                description="Force re-authentication after this total duration, even if the session remains active."
                value={absoluteSessionTimeout}
                saving={savingAbsoluteTimeout}
                error={absoluteTimeoutError}
                options={absoluteSessionTimeoutOptions}
                onValueChange={(value) => {
                  void saveTenantPatch({
                    patch: { absoluteSessionTimeoutSeconds: Number(value) },
                    setSaving: setSavingAbsoluteTimeout,
                    setError: setAbsoluteTimeoutError,
                    fallbackMessage: 'Failed to update absolute session timeout.',
                    onSuccess: () => setAbsoluteSessionTimeout(value),
                  });
                }}
              />
            </SettingsSectionBlock>

            <SettingsSectionBlock
              title="Login protection"
              description="Control abusive login attempts, account lockout behavior, and impossible-travel detection."
            >
              <TenantPolicySelectField
                label="Rate limit window"
                description="Time window used to count failed login attempts."
                value={loginRateLimitWindow}
                saving={savingRateLimitWindow}
                error={rateLimitWindowError}
                options={loginRateLimitWindowOptions}
                onValueChange={(value) => {
                  void saveTenantPatch({
                    patch: { loginRateLimitWindowMs: value === 'default' ? null : Number(value) },
                    setSaving: setSavingRateLimitWindow,
                    setError: setRateLimitWindowError,
                    fallbackMessage: 'Failed to update rate limit window.',
                    onSuccess: () => setLoginRateLimitWindow(value),
                  });
                }}
              />
              <TenantPolicySelectField
                label="Max login attempts"
                description="Maximum failed login attempts inside the rate limit window."
                value={loginRateLimitMaxAttempts}
                saving={savingRateLimitMaxAttempts}
                error={rateLimitMaxAttemptsError}
                options={loginAttemptOptions}
                onValueChange={(value) => {
                  void saveTenantPatch({
                    patch: { loginRateLimitMaxAttempts: value === 'default' ? null : Number(value) },
                    setSaving: setSavingRateLimitMaxAttempts,
                    setError: setRateLimitMaxAttemptsError,
                    fallbackMessage: 'Failed to update max login attempts.',
                    onSuccess: () => setLoginRateLimitMaxAttempts(value),
                  });
                }}
              />
              <TenantPolicySelectField
                label="Account lockout threshold"
                description="Failed attempts before the account is considered locked."
                value={accountLockoutThreshold}
                saving={savingLockoutThreshold}
                error={lockoutThresholdError}
                options={loginAttemptOptions}
                onValueChange={(value) => {
                  void saveTenantPatch({
                    patch: { accountLockoutThreshold: value === 'default' ? null : Number(value) },
                    setSaving: setSavingLockoutThreshold,
                    setError: setLockoutThresholdError,
                    fallbackMessage: 'Failed to update lockout threshold.',
                    onSuccess: () => setAccountLockoutThreshold(value),
                  });
                }}
              />
              <TenantPolicySelectField
                label="Account lockout duration"
                description="How long locked accounts remain unavailable after crossing the threshold."
                value={accountLockoutDuration}
                saving={savingLockoutDuration}
                error={lockoutDurationError}
                options={accountLockoutDurationOptions}
                onValueChange={(value) => {
                  void saveTenantPatch({
                    patch: { accountLockoutDurationMs: value === 'default' ? null : Number(value) },
                    setSaving: setSavingLockoutDuration,
                    setError: setLockoutDurationError,
                    fallbackMessage: 'Failed to update lockout duration.',
                    onSuccess: () => setAccountLockoutDuration(value),
                  });
                }}
              />
              <TenantPolicySelectField
                label="Impossible travel speed"
                description="Flag login location changes that imply travel faster than this speed."
                value={impossibleTravelSpeed}
                saving={savingTravelSpeed}
                error={travelSpeedError}
                options={impossibleTravelSpeedOptions}
                onValueChange={(value) => {
                  void saveTenantPatch({
                    patch: { impossibleTravelSpeedKmh: value === 'default' ? null : Number(value) },
                    setSaving: setSavingTravelSpeed,
                    setError: setTravelSpeedError,
                    fallbackMessage: 'Failed to update impossible travel speed.',
                    onSuccess: () => setImpossibleTravelSpeed(value),
                  });
                }}
              />
            </SettingsSectionBlock>

            <SettingsSectionBlock
              title="Token lifetime"
              description="Align access token, refresh token, and vault default TTL lifetimes."
            >
              <TenantPolicySelectField
                label="Access token expiry"
                description="How long access tokens remain valid before the client must refresh them."
                value={jwtExpiresIn}
                saving={savingJwtExpires}
                error={jwtExpiresError}
                options={accessTokenExpiryOptions}
                onValueChange={(value) => {
                  void saveTenantPatch({
                    patch: { jwtExpiresInSeconds: value === 'default' ? null : Number(value) },
                    setSaving: setSavingJwtExpires,
                    setError: setJwtExpiresError,
                    fallbackMessage: 'Failed to update access token expiry.',
                    onSuccess: () => setJwtExpiresIn(value),
                  });
                }}
              />
              <TenantPolicySelectField
                label="Refresh token expiry"
                description="Longer-lived tokens control how long users stay signed in without a full re-login."
                value={jwtRefreshExpiresIn}
                saving={savingJwtRefreshExpires}
                error={jwtRefreshExpiresError}
                options={refreshTokenExpiryOptions}
                onValueChange={(value) => {
                  void saveTenantPatch({
                    patch: { jwtRefreshExpiresInSeconds: value === 'default' ? null : Number(value) },
                    setSaving: setSavingJwtRefreshExpires,
                    setError: setJwtRefreshExpiresError,
                    fallbackMessage: 'Failed to update refresh token expiry.',
                    onSuccess: () => setJwtRefreshExpiresIn(value),
                  });
                }}
              />
              <TenantPolicySelectField
                label="Vault default TTL"
                description="Default auto-lock timeout applied to new users unless they choose a stricter setting."
                value={vaultDefaultTtl}
                saving={savingVaultDefaultTtl}
                error={vaultDefaultTtlError}
                options={vaultDefaultTtlOptions}
                onValueChange={(value) => {
                  void saveTenantPatch({
                    patch: { vaultDefaultTtlMinutes: value === 'default' ? null : Number(value) },
                    setSaving: setSavingVaultDefaultTtl,
                    setError: setVaultDefaultTtlError,
                    fallbackMessage: 'Failed to update vault default TTL.',
                    onSuccess: () => setVaultDefaultTtl(value),
                  });
                }}
              />
            </SettingsSectionBlock>

            <SettingsSectionBlock
              title="Data controls"
              description="Limit clipboard/file transfer exposure, recording retention, and user storage quotas."
            >
              {dlpError ? (
                <Alert variant="destructive">
                  <AlertDescription>{dlpError}</AlertDescription>
                </Alert>
              ) : null}
              <SettingsSwitchRow
                title="Disable clipboard copy"
                description="Block remote-to-local clipboard copy for RDP and VNC sessions."
                checked={dlpDisableCopy}
                disabled={savingDlp}
                onCheckedChange={(checked) => {
                  void saveTenantPatch({
                    patch: { dlpDisableCopy: checked },
                    setSaving: setSavingDlp,
                    setError: setDlpError,
                    fallbackMessage: 'Failed to update DLP policy.',
                    onSuccess: () => setDlpDisableCopy(checked),
                  });
                }}
              />
              <SettingsSwitchRow
                title="Disable clipboard paste"
                description="Block local-to-remote clipboard paste for RDP and VNC sessions."
                checked={dlpDisablePaste}
                disabled={savingDlp}
                onCheckedChange={(checked) => {
                  void saveTenantPatch({
                    patch: { dlpDisablePaste: checked },
                    setSaving: setSavingDlp,
                    setError: setDlpError,
                    fallbackMessage: 'Failed to update DLP policy.',
                    onSuccess: () => setDlpDisablePaste(checked),
                  });
                }}
              />
              <SettingsSwitchRow
                title="Disable file download"
                description="Prevent downloading files from the shared drive back to the local device."
                checked={dlpDisableDownload}
                disabled={savingDlp}
                onCheckedChange={(checked) => {
                  void saveTenantPatch({
                    patch: { dlpDisableDownload: checked },
                    setSaving: setSavingDlp,
                    setError: setDlpError,
                    fallbackMessage: 'Failed to update DLP policy.',
                    onSuccess: () => setDlpDisableDownload(checked),
                  });
                }}
              />
              <SettingsSwitchRow
                title="Disable file upload"
                description="Block file uploads into remote shared drives."
                checked={dlpDisableUpload}
                disabled={savingDlp}
                onCheckedChange={(checked) => {
                  void saveTenantPatch({
                    patch: { dlpDisableUpload: checked },
                    setSaving: setSavingDlp,
                    setError: setDlpError,
                    fallbackMessage: 'Failed to update DLP policy.',
                    onSuccess: () => setDlpDisableUpload(checked),
                  });
                }}
              />

              {recordingsFeatureEnabled ? (
                <>
                  {recordingError ? (
                    <Alert variant="destructive">
                      <AlertDescription>{recordingError}</AlertDescription>
                    </Alert>
                  ) : null}
                  <SettingsSwitchRow
                    title="Enable session recording"
                    description="Capture SSH, RDP, and VNC sessions for later review."
                    checked={recordingEnabled}
                    disabled={savingRecording}
                    onCheckedChange={(checked) => {
                      void saveTenantPatch({
                        patch: { recordingEnabled: checked },
                        setSaving: setSavingRecording,
                        setError: setRecordingError,
                        fallbackMessage: 'Failed to update recording policy.',
                        onSuccess: () => setRecordingEnabled(checked),
                      });
                    }}
                  />
                  <TenantInlineSaveField
                    label="Recording retention (days)"
                    description="Leave blank to inherit the system default."
                    value={recordingRetentionDays}
                    saving={savingRetention}
                    error={retentionError}
                    type="number"
                    helperText="Choose a value between 1 and 3650 days or leave blank."
                    onChange={(value) => {
                      setRecordingRetentionDays(value);
                      setRetentionError('');
                    }}
                    onSave={handleSaveRetention}
                  />
                </>
              ) : null}

              <div className="grid gap-4 xl:grid-cols-2">
                <TenantInlineSaveField
                  label="User drive quota (MB)"
                  description="Leave blank to inherit the system default."
                  value={userDriveQuotaMb}
                  saving={savingStorage}
                  error={storageError}
                  type="number"
                  onChange={(value) => {
                    setUserDriveQuotaMb(value);
                    setStorageError('');
                  }}
                  onSave={handleSaveStorage}
                />
              </div>
            </SettingsSectionBlock>
          </SettingsFieldGroup>
        </SettingsPanel>
      ) : null}

      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
      <CreateUserDialog open={createUserOpen} onClose={() => setCreateUserOpen(false)} />

      <DeleteTenantDialog
        open={deleteConfirmOpen}
        tenantName={tenant.name}
        confirmName={deleteConfirmName}
        deleting={deleting}
        onConfirmNameChange={setDeleteConfirmName}
        onClose={() => {
          setDeleteConfirmOpen(false);
          setDeleteConfirmName('');
        }}
        onConfirm={handleDeleteTenant}
      />

      <RemoveMemberDialog
        open={Boolean(removeTarget)}
        target={removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={() => { void handleRemoveUser(); }}
      />

      <MembershipExpiryDialog
        open={expiryDialogOpen}
        target={expiryTarget}
        value={expiryValue}
        saving={savingExpiry}
        onClose={() => setExpiryDialogOpen(false)}
        onValueChange={setExpiryValue}
        onSave={() => { void handleSaveExpiry(); }}
        onRemove={() => { void handleRemoveExpiry(); }}
      />

      <ChangeUserEmailDialog
        open={changeEmailOpen}
        target={changeEmailTarget}
        newEmail={newEmail}
        phase={changeEmailPhase}
        verificationId={changeEmailVerificationId}
        method={changeEmailMethod}
        metadata={changeEmailMetadata}
        loading={changeEmailLoading}
        error={changeEmailError}
        onClose={() => setChangeEmailOpen(false)}
        onEmailChange={setNewEmail}
        onSubmit={() => { void handleAdminEmailSubmit(); }}
        onVerified={(verificationId) => { void handleAdminEmailVerified(verificationId); }}
      />

      <ChangeUserPasswordDialog
        open={changePwdOpen}
        target={changePwdTarget}
        newPassword={newPassword}
        confirmPassword={confirmPassword}
        phase={changePwdPhase}
        verificationId={changePwdVerificationId}
        method={changePwdMethod}
        metadata={changePwdMetadata}
        loading={changePwdLoading}
        error={changePwdError}
        recoveryKey={recoveryKey}
        onClose={() => setChangePwdOpen(false)}
        onNewPasswordChange={setNewPassword}
        onConfirmPasswordChange={setConfirmPassword}
        onSubmit={() => { void handleAdminPasswordSubmit(); }}
        onVerified={(verificationId) => { void handleAdminPasswordVerified(verificationId); }}
        onCopyRecoveryKey={() => navigator.clipboard.writeText(recoveryKey)}
      />

      <MandatoryMfaDialog
        open={mfaConfirmOpen}
        stats={mfaStats}
        onClose={() => setMfaConfirmOpen(false)}
        onConfirm={() => { void handleConfirmEnableMfa(); }}
      />

      {tenant && permTarget ? (
        <PermissionOverridesDialog
          open={permDialogOpen}
          onClose={() => setPermDialogOpen(false)}
          tenantId={tenant.id}
          userId={permTarget.id}
          userName={permTarget.name}
        />
      ) : null}
    </>
  );
}
