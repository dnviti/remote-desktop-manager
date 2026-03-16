import { useState, useEffect, useRef } from 'react';
import {
  Card, CardContent, Typography, TextField, Button, Alert, Avatar, Stack, Box, Divider,
} from '@mui/material';
import { useAuthStore } from '../../store/authStore';
import {
  getProfile, updateProfile, uploadAvatar,
  initiateEmailChange, confirmEmailChange,
  type EmailChangeInitResult, type VerificationMethod,
} from '../../api/user.api';
import IdentityVerification from '../common/IdentityVerification';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { useNotificationStore } from '../../store/notificationStore';

interface ProfileSectionProps {
  onHasPasswordResolved: (hasPassword: boolean) => void;
  linkedProvider?: string | null;
}

type EmailChangePhase = 'idle' | 'entering-email' | 'dual-otp' | 'identity-verifying';

export default function ProfileSection({ onHasPasswordResolved, linkedProvider }: ProfileSectionProps) {
  const updateUser = useAuthStore((s) => s.updateUser);

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const { loading, error, setError, run } = useAsyncAction();
  const notify = useNotificationStore((s) => s.notify);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Email change state
  const [emailChangePhase, setEmailChangePhase] = useState<EmailChangePhase>('idle');
  const [newEmail, setNewEmail] = useState('');
  const { loading: emailChangeLoading, error: emailChangeError, setError: setEmailChangeError, run: runEmailChange } = useAsyncAction();
  const [codeOld, setCodeOld] = useState('');
  const [codeNew, setCodeNew] = useState('');
  const [verificationId, setVerificationId] = useState('');
  const [verificationMethod, setVerificationMethod] = useState<VerificationMethod>('password');
  const [verificationMetadata, setVerificationMetadata] = useState<Record<string, unknown>>();

  useEffect(() => {
    getProfile().then((profile) => {
      setUsername(profile.username ?? '');
      setEmail(profile.email);
      setAvatarPreview(profile.avatarData);
      onHasPasswordResolved(profile.hasPassword);
    }).catch(() => {
      setError('Failed to load profile');
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time profile load on mount
  }, []);

  useEffect(() => {
    if (linkedProvider) {
      notify(`${linkedProvider.charAt(0).toUpperCase() + linkedProvider.slice(1)} account linked successfully`, 'success');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- notify is stable
  }, [linkedProvider]);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 200 * 1024) {
      setError('Avatar must be under 200KB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setAvatarPreview(dataUrl);
      setError('');
      uploadAvatar(dataUrl).then((result) => {
        updateUser({ avatarData: result.avatarData });
        notify('Avatar updated', 'success');
      }).catch(() => {
        setError('Failed to upload avatar');
      });
    };
    reader.readAsDataURL(file);
  };

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(async () => {
      const result = await updateProfile({ username: username || undefined });
      updateUser({ username: result.username });
    }, 'Failed to update profile');
    if (ok) notify('Profile updated successfully', 'success');
  };

  const handleInitiateEmailChange = async () => {
    if (!newEmail || newEmail === email) {
      setEmailChangeError('Please enter a different email address.');
      return;
    }
    await runEmailChange(async () => {
      const result: EmailChangeInitResult = await initiateEmailChange(newEmail);
      if (result.flow === 'dual-otp') {
        setEmailChangePhase('dual-otp');
      } else {
        setVerificationId(result.verificationId ?? '');
        setVerificationMethod(result.method ?? 'password');
        setVerificationMetadata(result.metadata);
        setEmailChangePhase('identity-verifying');
      }
    }, 'Failed to initiate email change');
  };

  const handleConfirmDualOtp = async () => {
    if (codeOld.length !== 6 || codeNew.length !== 6) {
      setEmailChangeError('Please enter both 6-digit codes.');
      return;
    }
    const ok = await runEmailChange(async () => {
      const result = await confirmEmailChange({ codeOld, codeNew });
      setEmail(result.email);
      updateUser({ email: result.email });
    }, 'Failed to confirm email change');
    if (ok) {
      notify('Email changed successfully', 'success');
      resetEmailChange();
    }
  };

  const handleIdentityVerified = async (vId: string) => {
    const ok = await runEmailChange(async () => {
      const result = await confirmEmailChange({ verificationId: vId });
      setEmail(result.email);
      updateUser({ email: result.email });
    }, 'Failed to confirm email change');
    if (ok) {
      notify('Email changed successfully', 'success');
      resetEmailChange();
    } else {
      setEmailChangePhase('entering-email');
    }
  };

  const resetEmailChange = () => {
    setEmailChangePhase('idle');
    setNewEmail('');
    setCodeOld('');
    setCodeNew('');
    setVerificationId('');
    setEmailChangeError('');
  };

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>Profile</Typography>
        <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
          <Avatar
            src={avatarPreview ?? undefined}
            sx={{ width: 64, height: 64, cursor: 'pointer' }}
            onClick={() => fileInputRef.current?.click()}
          />
          <Button variant="outlined" size="small" onClick={() => fileInputRef.current?.click()}>
            Change Avatar
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={handleAvatarChange}
          />
        </Stack>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Box component="form" onSubmit={handleProfileSave}>
          <TextField
            fullWidth label="Username" value={username}
            onChange={(e) => setUsername(e.target.value)}
            margin="normal"
            placeholder="Optional display name"
          />
          <TextField
            fullWidth label="Email" value={email}
            margin="normal"
            slotProps={{ input: { readOnly: true } }}
            helperText="Use the 'Change Email' button below to update your email"
          />
          <Button
            type="submit" variant="contained" disabled={loading}
            sx={{ mt: 2 }}
          >
            {loading ? 'Saving...' : 'Save Profile'}
          </Button>
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* Email Change Section */}
        <Typography variant="subtitle1" gutterBottom>Change Email</Typography>

        {emailChangeError && <Alert severity="error" sx={{ mb: 2 }}>{emailChangeError}</Alert>}

        {emailChangePhase === 'idle' && (
          <Button
            variant="outlined"
            onClick={() => setEmailChangePhase('entering-email')}
          >
            Change Email
          </Button>
        )}

        {emailChangePhase === 'entering-email' && (
          <Stack spacing={2}>
            <TextField
              fullWidth label="New Email" type="email" value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              size="small"
              autoFocus
            />
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                onClick={handleInitiateEmailChange}
                disabled={emailChangeLoading}
              >
                {emailChangeLoading ? 'Sending...' : 'Continue'}
              </Button>
              <Button variant="outlined" onClick={resetEmailChange}>Cancel</Button>
            </Stack>
          </Stack>
        )}

        {emailChangePhase === 'dual-otp' && (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              Verification codes have been sent to both your current and new email addresses.
            </Typography>
            <TextField
              fullWidth label="Code from current email" value={codeOld}
              onChange={(e) => setCodeOld(e.target.value.replace(/\D/g, '').slice(0, 6))}
              size="small"
              inputProps={{ maxLength: 6, inputMode: 'numeric' }}
              autoFocus
            />
            <TextField
              fullWidth label="Code from new email" value={codeNew}
              onChange={(e) => setCodeNew(e.target.value.replace(/\D/g, '').slice(0, 6))}
              size="small"
              inputProps={{ maxLength: 6, inputMode: 'numeric' }}
            />
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                onClick={handleConfirmDualOtp}
                disabled={emailChangeLoading}
              >
                {emailChangeLoading ? 'Verifying...' : 'Confirm'}
              </Button>
              <Button variant="outlined" onClick={resetEmailChange}>Cancel</Button>
            </Stack>
          </Stack>
        )}

        {emailChangePhase === 'identity-verifying' && (
          <IdentityVerification
            verificationId={verificationId}
            method={verificationMethod}
            metadata={verificationMetadata}
            onVerified={handleIdentityVerified}
            onCancel={resetEmailChange}
          />
        )}
      </CardContent>
    </Card>
  );
}
