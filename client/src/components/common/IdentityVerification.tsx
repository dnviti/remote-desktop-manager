import { useState } from 'react';
import {
  Box, TextField, Button, Typography, Alert, Stack, CircularProgress,
} from '@mui/material';
import { Key as KeyIcon, Fingerprint as FingerprintIcon } from '@mui/icons-material';
import { startAuthentication } from '@simplewebauthn/browser';
import { confirmIdentityVerification, type VerificationMethod } from '../../api/user.api';

interface IdentityVerificationProps {
  verificationId: string;
  method: VerificationMethod;
  metadata?: Record<string, unknown>;
  onVerified: (verificationId: string) => void;
  onCancel: () => void;
}

const methodLabels: Record<VerificationMethod, string> = {
  email: 'Enter the verification code sent to your email',
  totp: 'Enter the code from your authenticator app',
  sms: 'Enter the verification code sent to your phone',
  webauthn: 'Verify with your security key or passkey',
  password: 'Enter your current password',
};

export default function IdentityVerification({
  verificationId,
  method,
  metadata,
  onVerified,
  onCancel,
}: IdentityVerificationProps) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError('');
    setLoading(true);

    try {
      let payload: { code?: string; credential?: unknown; password?: string } = {};

      switch (method) {
        case 'email':
        case 'totp':
        case 'sms':
          if (!code || code.length !== 6) {
            setError('Please enter a valid 6-digit code.');
            setLoading(false);
            return;
          }
          payload = { code };
          break;
        case 'webauthn': {
          const options = metadata?.options as Record<string, unknown> | undefined;
          if (!options) {
            setError('WebAuthn options not available.');
            setLoading(false);
            return;
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const credential = await startAuthentication({ optionsJSON: options as any });
          payload = { credential };
          break;
        }
        case 'password':
          if (!password) {
            setError('Please enter your password.');
            setLoading(false);
            return;
          }
          payload = { password };
          break;
      }

      const result = await confirmIdentityVerification(verificationId, payload);
      if (result.confirmed) {
        onVerified(verificationId);
      } else {
        setError('Verification failed. Please try again.');
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        || 'Verification failed. Please try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) {
      handleSubmit();
    }
  };

  const hint = method === 'email' && metadata?.maskedEmail
    ? `Code sent to ${metadata.maskedEmail}`
    : method === 'sms' && metadata?.maskedPhone
      ? `Code sent to ${metadata.maskedPhone}`
      : undefined;

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <FingerprintIcon color="primary" fontSize="small" />
        <Typography variant="subtitle2">Identity Verification</Typography>
      </Stack>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {methodLabels[method]}
      </Typography>

      {hint && (
        <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
          {hint}
        </Typography>
      )}

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {(method === 'email' || method === 'totp' || method === 'sms') && (
        <TextField
          label="Verification Code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={handleKeyDown}
          inputProps={{ maxLength: 6, inputMode: 'numeric', pattern: '[0-9]*' }}
          size="small"
          fullWidth
          autoFocus
          sx={{ mb: 2 }}
        />
      )}

      {method === 'password' && (
        <TextField
          label="Current Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={handleKeyDown}
          size="small"
          fullWidth
          autoFocus
          sx={{ mb: 2 }}
        />
      )}

      <Stack direction="row" spacing={1}>
        {method === 'webauthn' ? (
          <Button
            variant="contained"
            startIcon={<KeyIcon />}
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? <CircularProgress size={20} /> : 'Verify with Security Key'}
          </Button>
        ) : (
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? <CircularProgress size={20} /> : 'Verify'}
          </Button>
        )}
        <Button variant="outlined" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
      </Stack>
    </Box>
  );
}
