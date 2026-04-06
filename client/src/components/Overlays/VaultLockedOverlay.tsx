import { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import {
  Box, Typography, TextField, Button, Alert,
  CircularProgress, Divider, Link, Dialog,
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
import { useAsyncAction } from '../../hooks/useAsyncAction';

type UnlockMethod = 'webauthn' | 'totp' | 'sms' | 'password';
const METHOD_PRIORITY: UnlockMethod[] = ['webauthn', 'totp', 'sms', 'password'];

function resolveAvailableMethods(
  mfaUnlockAvailable: boolean,
  mfaUnlockMethods: string[],
): UnlockMethod[] {
  return mfaUnlockAvailable
    ? METHOD_PRIORITY.filter((method) => method === 'password' || mfaUnlockMethods.includes(method))
    : ['password'];
}

function resolvePreferredMethod(
  mfaUnlockAvailable: boolean,
  mfaUnlockMethods: string[],
): UnlockMethod {
  return resolveAvailableMethods(mfaUnlockAvailable, mfaUnlockMethods)[0] ?? 'password';
}

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


export default function VaultLockedOverlay() {
  const unlocked = useVaultStore((s) => s.unlocked);
  const initialized = useVaultStore((s) => s.initialized);
  const mfaUnlockAvailable = useVaultStore((s) => s.mfaUnlockAvailable);
  const mfaUnlockMethods = useVaultStore((s) => s.mfaUnlockMethods);
  const checkVaultStatus = useVaultStore((s) => s.checkStatus);
  const setVaultUnlocked = useVaultStore((s) => s.setUnlocked);
  const authLogout = useAuthStore((s) => s.logout);

  const [activeMethod, setActiveMethod] = useState<UnlockMethod>('password');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const { loading, error, clearError, run } = useAsyncAction();
  const [smsSent, setSmsSent] = useState(false);
  const autoWebAuthnTriggeredRef = useRef(false);
  const lockStatusResolvedRef = useRef(false);
  const [statusRefreshing, setStatusRefreshing] = useState(false);
  const mountedRef = useRef(true);

  const needsLockStatusRefresh =
    initialized &&
    !unlocked &&
    !mfaUnlockAvailable &&
    mfaUnlockMethods.length === 0;

  // Determine default method based on priority
  useLayoutEffect(() => {
    const availableMethods = resolveAvailableMethods(mfaUnlockAvailable, mfaUnlockMethods);
    const preferredMethod = availableMethods[0] ?? 'password';
    setActiveMethod((current) => {
      if (!availableMethods.includes(current)) {
        return preferredMethod;
      }
      if (current === 'password' && preferredMethod === 'webauthn') {
        return 'webauthn';
      }
      return current;
    });
  }, [mfaUnlockAvailable, mfaUnlockMethods]);

  // Reset state when switching methods
  useEffect(() => {
    clearError();
    setCode('');
    setPassword('');
    setSmsSent(false);
  }, [activeMethod, clearError]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (unlocked) {
      lockStatusResolvedRef.current = false;
      setStatusRefreshing(false);
      return;
    }
    if (!needsLockStatusRefresh || lockStatusResolvedRef.current) {
      return;
    }

    lockStatusResolvedRef.current = true;
    setStatusRefreshing(true);

    void checkVaultStatus().finally(() => {
      if (mountedRef.current) {
        setStatusRefreshing(false);
      }
    });
  }, [checkVaultStatus, needsLockStatusRefresh, unlocked]);

  const onSuccess = useCallback(() => {
    setVaultUnlocked(true);
    setPassword('');
    setCode('');
  }, [setVaultUnlocked]);

  // WebAuthn flow
  const handleWebAuthn = useCallback(async () => {
    await run(async () => {
      const options = await requestVaultWebAuthnOptions();
      const credential = await startAuthentication({ optionsJSON: options });
      await unlockVaultWithWebAuthn(credential);
      onSuccess();
    }, 'WebAuthn authentication failed');
  }, [onSuccess, run]);

  // Auto-trigger WebAuthn when it's the active method
  useEffect(() => {
    if (unlocked) {
      autoWebAuthnTriggeredRef.current = false;
      return;
    }
    if (activeMethod !== 'webauthn' || !initialized || autoWebAuthnTriggeredRef.current) {
      return;
    }
    autoWebAuthnTriggeredRef.current = true;
    void handleWebAuthn();
  }, [activeMethod, handleWebAuthn, initialized, unlocked]);

  const handlePasswordSubmit = async () => {
    const ok = await run(async () => {
      await unlockVault(password);
    }, 'Failed to unlock vault');
    if (ok) onSuccess();
  };

  const handleTotpSubmit = async () => {
    const ok = await run(async () => {
      await unlockVaultWithTotp(code);
    }, 'Invalid TOTP code');
    if (ok) onSuccess();
  };

  const handleSmsRequest = async () => {
    const ok = await run(async () => {
      await requestVaultSmsCode();
    }, 'Failed to send SMS code');
    if (ok) setSmsSent(true);
  };

  const handleSmsSubmit = async () => {
    const ok = await run(async () => {
      await unlockVaultWithSms(code);
    }, 'Invalid or expired SMS code');
    if (ok) onSuccess();
  };

  const handleLogout = async () => {
    try { await logoutApi(); } catch { /* ignore */ }
    authLogout();
  };

  const handleKeyDown = (e: React.KeyboardEvent, onSubmit: () => void) => {
    if (e.key === 'Enter' && !loading) onSubmit();
  };

  if (unlocked || !initialized) return null;

  const availableMethods = resolveAvailableMethods(mfaUnlockAvailable, mfaUnlockMethods);
  const otherMethods = availableMethods.filter((m) => m !== activeMethod);

  return (
    <Dialog
      open
      disableEscapeKeyDown
      sx={{ zIndex: 1400 }}
      slotProps={{
        backdrop: { sx: { bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(8,8,10,0.7)' : 'rgba(0,0,0,0.4)' } },
        paper: { elevation: 8, sx: { p: 4, maxWidth: 400, width: '100%', textAlign: 'center', bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 4 } },
      }}
    >
        <LockIcon sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
        <Typography variant="h6" gutterBottom sx={{ fontFamily: (theme) => theme.typography.h5.fontFamily, color: 'text.primary' }}>
          Vault Locked
        </Typography>
        <Typography variant="body2" sx={{ mb: 3, color: 'text.secondary' }}>
          {activeMethod !== 'password'
            ? 'Your vault was locked. Verify your identity to unlock.'
            : 'Your vault was locked due to inactivity timeout. Enter your password to unlock and resume.'}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2, textAlign: 'left' }}>
            {error}
          </Alert>
        )}

        {statusRefreshing && (
          <Box sx={{ my: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <CircularProgress size={32} />
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Checking available unlock methods...
            </Typography>
          </Box>
        )}

        {/* WebAuthn */}
        {!statusRefreshing && activeMethod === 'webauthn' && (
          <Box sx={{ my: 2 }}>
            {loading ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <CircularProgress size={32} />
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Waiting for your security key or passkey...
                </Typography>
              </Box>
            ) : (
              <Button
                onClick={handleWebAuthn}
                variant="contained"
                fullWidth
                startIcon={<FingerprintIcon />}
                sx={{ bgcolor: 'primary.main', color: (theme) => theme.palette.getContrastText(theme.palette.primary.main), '&:hover': { bgcolor: 'secondary.main' } }}
              >
                Retry Passkey
              </Button>
            )}
          </Box>
        )}

        {/* TOTP */}
        {!statusRefreshing && activeMethod === 'totp' && (
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
              sx={{ mt: 1, bgcolor: 'primary.main', color: (theme) => theme.palette.getContrastText(theme.palette.primary.main), '&:hover': { bgcolor: 'secondary.main' } }}
            >
              {loading ? 'Verifying...' : 'Verify Code'}
            </Button>
          </Box>
        )}

        {/* SMS */}
        {!statusRefreshing && activeMethod === 'sms' && (
          <Box>
            {!smsSent ? (
              <Button
                onClick={handleSmsRequest}
                variant="contained"
                fullWidth
                disabled={loading}
                startIcon={<SmsIcon />}
                sx={{ mt: 1, bgcolor: 'primary.main', color: (theme) => theme.palette.getContrastText(theme.palette.primary.main), '&:hover': { bgcolor: 'secondary.main' } }}
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
                  sx={{ mt: 1, bgcolor: 'primary.main', color: (theme) => theme.palette.getContrastText(theme.palette.primary.main), '&:hover': { bgcolor: 'secondary.main' } }}
                >
                  {loading ? 'Verifying...' : 'Verify Code'}
                </Button>
              </>
            )}
          </Box>
        )}

        {/* Password */}
        {!statusRefreshing && activeMethod === 'password' && (
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
              sx={{ mt: 1, bgcolor: 'primary.main', color: (theme) => theme.palette.getContrastText(theme.palette.primary.main), '&:hover': { bgcolor: 'secondary.main' } }}
            >
              {loading ? 'Unlocking...' : 'Unlock Vault'}
            </Button>
          </Box>
        )}

        {/* Method switcher */}
        {!statusRefreshing && otherMethods.length > 0 && (
          <>
            <Divider sx={{ my: 2, borderColor: 'divider' }} />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {otherMethods.map((method) => (
                <Link
                  key={method}
                  component="button"
                  variant="body2"
                  onClick={() => setActiveMethod(method)}
                  sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, justifyContent: 'center', color: 'primary.main' }}
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
          sx={{ mt: 2, color: 'text.secondary' }}
        >
          Logout
        </Button>
    </Dialog>
  );
}
