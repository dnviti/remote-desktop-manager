import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, TextField, Button, Alert, Paper,
  CircularProgress, Divider, Link,
} from '@mui/material';
import {
  Lock as LockIcon,
  Fingerprint as FingerprintIcon,
  Smartphone as SmartphoneIcon,
  Sms as SmsIcon,
  Key as KeyIcon,
} from '@mui/icons-material';
import { startAuthentication } from '@simplewebauthn/browser';
import {
  unlockVault,
  unlockVaultWithTotp,
  requestVaultWebAuthnOptions,
  unlockVaultWithWebAuthn,
  requestVaultSmsCode,
  unlockVaultWithSms,
} from '../../api/vault.api';
import { logoutApi } from '../../api/auth.api';
import { useVaultStore } from '../../store/vaultStore';
import { useAuthStore } from '../../store/authStore';

type UnlockMethod = 'webauthn' | 'totp' | 'sms' | 'password';
const METHOD_PRIORITY: UnlockMethod[] = ['webauthn', 'totp', 'sms', 'password'];

function getMethodLabel(method: UnlockMethod): string {
  switch (method) {
    case 'webauthn': return 'passkey';
    case 'totp': return 'authenticator app';
    case 'sms': return 'SMS code';
    case 'password': return 'password';
  }
}

function getMethodIcon(method: UnlockMethod) {
  switch (method) {
    case 'webauthn': return <FingerprintIcon fontSize="small" />;
    case 'totp': return <SmartphoneIcon fontSize="small" />;
    case 'sms': return <SmsIcon fontSize="small" />;
    case 'password': return <KeyIcon fontSize="small" />;
  }
}

function extractError(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error
    || (err as Error)?.message
    || fallback;
}

export default function VaultLockedOverlay() {
  const unlocked = useVaultStore((s) => s.unlocked);
  const initialized = useVaultStore((s) => s.initialized);
  const mfaUnlockAvailable = useVaultStore((s) => s.mfaUnlockAvailable);
  const mfaUnlockMethods = useVaultStore((s) => s.mfaUnlockMethods);
  const setVaultUnlocked = useVaultStore((s) => s.setUnlocked);
  const authLogout = useAuthStore((s) => s.logout);

  const [activeMethod, setActiveMethod] = useState<UnlockMethod>('password');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [smsSent, setSmsSent] = useState(false);

  // Determine default method based on priority
  useEffect(() => {
    if (!mfaUnlockAvailable) {
      setActiveMethod('password');
      return;
    }
    const best = METHOD_PRIORITY.find((m) =>
      m === 'password' || mfaUnlockMethods.includes(m)
    );
    setActiveMethod(best ?? 'password');
  }, [mfaUnlockAvailable, mfaUnlockMethods]);

  // Reset state when switching methods
  useEffect(() => {
    setError('');
    setCode('');
    setPassword('');
    setSmsSent(false);
    setLoading(false);
  }, [activeMethod]);

  const onSuccess = useCallback(() => {
    setVaultUnlocked(true);
    setPassword('');
    setCode('');
  }, [setVaultUnlocked]);

  // WebAuthn flow
  const handleWebAuthn = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const options = await requestVaultWebAuthnOptions();
      const credential = await startAuthentication({ optionsJSON: options });
      await unlockVaultWithWebAuthn(credential);
      onSuccess();
    } catch (err: unknown) {
      setError(extractError(err, 'WebAuthn authentication failed'));
    } finally {
      setLoading(false);
    }
  }, [onSuccess]);

  // Auto-trigger WebAuthn when it's the active method
  useEffect(() => {
    if (activeMethod === 'webauthn' && !unlocked && initialized) {
      handleWebAuthn();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMethod, initialized]);

  const handlePasswordSubmit = async () => {
    setError('');
    setLoading(true);
    try {
      await unlockVault(password);
      onSuccess();
    } catch (err: unknown) {
      setError(extractError(err, 'Failed to unlock vault'));
    } finally {
      setLoading(false);
    }
  };

  const handleTotpSubmit = async () => {
    setError('');
    setLoading(true);
    try {
      await unlockVaultWithTotp(code);
      onSuccess();
    } catch (err: unknown) {
      setError(extractError(err, 'Invalid TOTP code'));
    } finally {
      setLoading(false);
    }
  };

  const handleSmsRequest = async () => {
    setError('');
    setLoading(true);
    try {
      await requestVaultSmsCode();
      setSmsSent(true);
    } catch (err: unknown) {
      setError(extractError(err, 'Failed to send SMS code'));
    } finally {
      setLoading(false);
    }
  };

  const handleSmsSubmit = async () => {
    setError('');
    setLoading(true);
    try {
      await unlockVaultWithSms(code);
      onSuccess();
    } catch (err: unknown) {
      setError(extractError(err, 'Invalid or expired SMS code'));
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try { await logoutApi(); } catch { /* ignore */ }
    authLogout();
  };

  const handleKeyDown = (e: React.KeyboardEvent, onSubmit: () => void) => {
    if (e.key === 'Enter' && !loading) onSubmit();
  };

  if (unlocked || !initialized) return null;

  const availableMethods: UnlockMethod[] = mfaUnlockAvailable
    ? METHOD_PRIORITY.filter((m) => m === 'password' || mfaUnlockMethods.includes(m))
    : ['password'];
  const otherMethods = availableMethods.filter((m) => m !== activeMethod);

  return (
    <Box
      sx={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 1400,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'rgba(0, 0, 0, 0.5)',
      }}
    >
      <Paper elevation={8} sx={{ p: 4, maxWidth: 400, width: '100%', textAlign: 'center' }}>
        <LockIcon sx={{ fontSize: 48, color: 'warning.main', mb: 2 }} />
        <Typography variant="h6" gutterBottom>
          Vault Locked
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {activeMethod !== 'password'
            ? 'Your vault was locked. Verify your identity to unlock.'
            : 'Your vault was locked due to inactivity timeout. Enter your password to unlock and resume.'}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2, textAlign: 'left' }}>
            {error}
          </Alert>
        )}

        {/* WebAuthn */}
        {activeMethod === 'webauthn' && (
          <Box sx={{ my: 2 }}>
            {loading ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <CircularProgress size={32} />
                <Typography variant="body2" color="text.secondary">
                  Waiting for your security key or passkey...
                </Typography>
              </Box>
            ) : (
              <Button
                onClick={handleWebAuthn}
                variant="contained"
                fullWidth
                startIcon={<FingerprintIcon />}
              >
                Retry Passkey
              </Button>
            )}
          </Box>
        )}

        {/* TOTP */}
        {activeMethod === 'totp' && (
          <Box>
            <TextField
              autoFocus
              label="Authenticator code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, handleTotpSubmit)}
              fullWidth
              margin="normal"
              slotProps={{ htmlInput: { maxLength: 6, inputMode: 'numeric', pattern: '[0-9]*' } }}
            />
            <Button
              onClick={handleTotpSubmit}
              variant="contained"
              fullWidth
              disabled={loading || code.length < 6}
              sx={{ mt: 1 }}
            >
              {loading ? 'Verifying...' : 'Verify Code'}
            </Button>
          </Box>
        )}

        {/* SMS */}
        {activeMethod === 'sms' && (
          <Box>
            {!smsSent ? (
              <Button
                onClick={handleSmsRequest}
                variant="contained"
                fullWidth
                disabled={loading}
                startIcon={<SmsIcon />}
                sx={{ mt: 1 }}
              >
                {loading ? 'Sending...' : 'Send SMS Code'}
              </Button>
            ) : (
              <>
                <TextField
                  autoFocus
                  label="SMS code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => handleKeyDown(e, handleSmsSubmit)}
                  fullWidth
                  margin="normal"
                  slotProps={{ htmlInput: { maxLength: 6, inputMode: 'numeric', pattern: '[0-9]*' } }}
                />
                <Button
                  onClick={handleSmsSubmit}
                  variant="contained"
                  fullWidth
                  disabled={loading || code.length < 6}
                  sx={{ mt: 1 }}
                >
                  {loading ? 'Verifying...' : 'Verify Code'}
                </Button>
              </>
            )}
          </Box>
        )}

        {/* Password */}
        {activeMethod === 'password' && (
          <Box>
            <TextField
              autoFocus
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, handlePasswordSubmit)}
              fullWidth
              margin="normal"
            />
            <Button
              onClick={handlePasswordSubmit}
              variant="contained"
              fullWidth
              disabled={loading}
              sx={{ mt: 1 }}
            >
              {loading ? 'Unlocking...' : 'Unlock Vault'}
            </Button>
          </Box>
        )}

        {/* Method switcher */}
        {otherMethods.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {otherMethods.map((method) => (
                <Link
                  key={method}
                  component="button"
                  variant="body2"
                  onClick={() => setActiveMethod(method)}
                  sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, justifyContent: 'center' }}
                >
                  {getMethodIcon(method)}
                  Use {getMethodLabel(method)} instead
                </Link>
              ))}
            </Box>
          </>
        )}

        <Button
          onClick={handleLogout}
          variant="text"
          fullWidth
          color="inherit"
          sx={{ mt: 2 }}
        >
          Logout
        </Button>
      </Paper>
    </Box>
  );
}
