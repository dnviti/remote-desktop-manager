import { useState } from 'react';
import {
  Card, CardContent, Typography, TextField, Button, Alert, Box,
} from '@mui/material';
import { useAuthStore } from '../../store/authStore';
import {
  changePassword, initiatePasswordChange,
  type VerificationMethod,
} from '../../api/user.api';
import IdentityVerification from '../common/IdentityVerification';
import PasswordStrengthMeter from '../common/PasswordStrengthMeter';
import RecoveryKeyConfirmDialog from '../common/RecoveryKeyConfirmDialog';
import { useAsyncAction } from '../../hooks/useAsyncAction';

interface ChangePasswordSectionProps {
  hasPassword: boolean;
}

type Phase = 'idle' | 'verifying-identity' | 'entering-password' | 'showing-recovery-key';

export default function ChangePasswordSection({ hasPassword }: ChangePasswordSectionProps) {
  const authLogout = useAuthStore((s) => s.logout);

  const [phase, setPhase] = useState<Phase>('idle');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const { loading, error, setError, run } = useAsyncAction();
  const [recoveryKey, setRecoveryKey] = useState('');

  // Identity verification state
  const [skipVerification, setSkipVerification] = useState(false);
  const [verificationId, setVerificationId] = useState('');
  const [verificationMethod, setVerificationMethod] = useState<VerificationMethod>('password');
  const [verificationMetadata, setVerificationMetadata] = useState<Record<string, unknown>>();
  const [completedVerificationId, setCompletedVerificationId] = useState<string>();

  if (!hasPassword) return null;

  const handleStartPasswordChange = async () => {
    await run(async () => {
      const result = await initiatePasswordChange();
      if (result.skipVerification) {
        setSkipVerification(true);
        setPhase('entering-password');
      } else {
        setSkipVerification(false);
        setVerificationId(result.verificationId ?? '');
        setVerificationMethod(result.method ?? 'password');
        setVerificationMetadata(result.metadata);
        setPhase('verifying-identity');
      }
    }, 'Failed to initiate password change');
  };

  const handleIdentityVerified = (vId: string) => {
    setCompletedVerificationId(vId);
    setPhase('entering-password');
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    const ok = await run(async () => {
      const result = await changePassword(
        skipVerification ? oldPassword : '',
        newPassword,
        completedVerificationId,
      );
      setRecoveryKey(result.recoveryKey);
    }, 'Failed to change password');
    if (ok) {
      setPhase('showing-recovery-key');
    }
  };

  const handleCancel = () => {
    setPhase('idle');
    setOldPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError('');
    setCompletedVerificationId(undefined);
  };

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>Change Password</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Changing your password will lock your vault and sign you out of all devices.
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {phase === 'idle' && (
          <Button
            variant="contained"
            color="warning"
            onClick={handleStartPasswordChange}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Change Password'}
          </Button>
        )}

        {phase === 'verifying-identity' && (
          <IdentityVerification
            verificationId={verificationId}
            method={verificationMethod}
            metadata={verificationMetadata}
            onVerified={handleIdentityVerified}
            onCancel={handleCancel}
          />
        )}

        {phase === 'entering-password' && (
          <Box component="form" onSubmit={handlePasswordChange}>
            {skipVerification && (
              <TextField
                fullWidth label="Current Password" type="password"
                value={oldPassword} onChange={(e) => setOldPassword(e.target.value)}
                margin="normal" required
              />
            )}
            <TextField
              fullWidth label="New Password" type="password"
              value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
              margin="normal" required
              helperText="Minimum 10 characters"
              autoFocus={!skipVerification}
              error={Boolean(newPassword) && newPassword.length > 0 && newPassword.length < 10}
              inputProps={{ minLength: 10 }}
            />
            <PasswordStrengthMeter password={newPassword} />
            <TextField
              fullWidth label="Confirm New Password" type="password"
              value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
              margin="normal" required
            />
            <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
              <Button
                type="submit" variant="contained" color="warning"
                disabled={loading}
              >
                {loading ? 'Changing...' : 'Change Password'}
              </Button>
              <Button variant="outlined" onClick={handleCancel}>Cancel</Button>
            </Box>
          </Box>
        )}
      </CardContent>
      <RecoveryKeyConfirmDialog
        open={phase === 'showing-recovery-key'}
        recoveryKey={recoveryKey}
        onConfirmed={() => { setRecoveryKey(''); authLogout(); }}
      />
    </Card>
  );
}
