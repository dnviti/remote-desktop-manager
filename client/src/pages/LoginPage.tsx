import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link as RouterLink, useSearchParams } from 'react-router-dom';
import {
  Box, TextField, Button, Typography, Alert, Link, Stack, CircularProgress,
  List, ListItemButton, ListItemIcon, ListItemText,
} from '@mui/material';
import { Business, CheckCircle } from '@mui/icons-material';
import { QRCodeSVG } from 'qrcode.react';
import { loginApi, verifyTotpApi, requestSmsCodeApi, verifySmsApi, mfaSetupInitApi, mfaSetupVerifyApi, requestWebAuthnOptionsApi, verifyWebAuthnApi, type AuthSuccessResponse, type TenantMembershipInfo } from '../api/auth.api';
import { switchTenant as switchTenantApi } from '../api/tenant.api';
import { startAuthentication } from '@simplewebauthn/browser';
import { resendVerificationEmail } from '../api/email.api';
import { useAuthStore } from '../store/authStore';
import { useVaultStore } from '../store/vaultStore';
import { useUiPreferencesStore } from '../store/uiPreferencesStore';
import OAuthButtons from '../components/OAuthButtons';
import { getOAuthProviders } from '../api/oauth.api';
import { extractApiError } from '../utils/apiError';

type Step = 'credentials' | 'mfa-choice' | 'totp' | 'sms' | 'webauthn' | 'mfa-setup' | 'tenant-select';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [ldapEnabled, setLdapEnabled] = useState(false);
  const ldapProviderName = 'LDAP';
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<Step>('credentials');
  const [tempToken, setTempToken] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [mfaMethods, setMfaMethods] = useState<string[]>([]);
  const [smsSending, setSmsSending] = useState(false);
  const [mfaSetupData, setMfaSetupData] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [mfaSetupCode, setMfaSetupCode] = useState('');
  const [showResend, setShowResend] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [pendingLoginData, setPendingLoginData] = useState<AuthSuccessResponse | null>(null);
  const [tenantMemberships, setTenantMemberships] = useState<TenantMembershipInfo[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const countdownRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const setAuth = useAuthStore((s) => s.setAuth);
  const setVaultUnlocked = useVaultStore((s) => s.setUnlocked);

  useEffect(() => {
    getOAuthProviders()
      .then((p) => {
        if (p.ldap) {
          setLdapEnabled(true);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (searchParams.get('verified') === 'true') {
      setSuccess('Email verified successfully! You can now sign in.');
      searchParams.delete('verified');
      setSearchParams(searchParams, { replace: true });
    }
    if (searchParams.get('registered') === 'true') {
      setSuccess('Registration successful! You can now sign in.');
      searchParams.delete('registered');
      setSearchParams(searchParams, { replace: true });
    }
    if (searchParams.get('passwordReset') === 'true') {
      setSuccess('Password reset successful! You can now sign in with your new password.');
      searchParams.delete('passwordReset');
      setSearchParams(searchParams, { replace: true });
    }
    const verifyError = searchParams.get('verifyError');
    if (verifyError) {
      setError(verifyError);
      searchParams.delete('verifyError');
      setSearchParams(searchParams, { replace: true });
    }
    const oauthError = searchParams.get('error');
    if (oauthError) {
      const errorCode = searchParams.get('code');
      if (errorCode === 'registration_disabled') {
        setError('Public registration is currently disabled. Contact your organization administrator to get an account.');
      } else if (errorCode === 'account_disabled') {
        setError('Your account has been disabled. Contact your organization administrator.');
      } else {
        setError(decodeURIComponent(oauthError));
      }
      searchParams.delete('error');
      searchParams.delete('code');
      setSearchParams(searchParams, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time URL param processing on mount
  }, []);

  const resendActive = resendCountdown > 0;
  useEffect(() => {
    if (!resendActive) {
      clearInterval(countdownRef.current);
      return;
    }
    countdownRef.current = setInterval(() => {
      setResendCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(countdownRef.current);
  }, [resendActive]);

  // Build the post-login redirect path, preserving the autoconnect query param
  const buildRedirect = () => {
    const autoconnect = searchParams.get('autoconnect');
    return autoconnect ? `/?autoconnect=${encodeURIComponent(autoconnect)}` : '/';
  };

  const completeLogin = (data: AuthSuccessResponse) => {
    const memberships = data.tenantMemberships ?? [];
    const acceptedMemberships = memberships.filter((m) => !m.pending);

    if (acceptedMemberships.length >= 2) {
      setPendingLoginData(data);
      setTenantMemberships(acceptedMemberships);

      const lastId = useUiPreferencesStore.getState().lastActiveTenantId;
      const preselect = acceptedMemberships.find((m) => m.tenantId === lastId)
        ?? acceptedMemberships.find((m) => m.isActive)
        ?? acceptedMemberships[0];
      setSelectedTenantId(preselect.tenantId);

      setStep('tenant-select');
      return;
    }

    setAuth(data.accessToken, data.csrfToken, data.user);
    setVaultUnlocked(true);
    const activeMembership = memberships.find((m) => m.isActive) ?? acceptedMemberships[0];
    if (activeMembership) {
      useUiPreferencesStore.getState().set('lastActiveTenantId', activeMembership.tenantId);
    }
    navigate(buildRedirect());
  };

  const handleTenantConfirm = async () => {
    if (!pendingLoginData || !selectedTenantId) return;
    setError('');
    setLoading(true);
    try {
      setAuth(pendingLoginData.accessToken, pendingLoginData.csrfToken, pendingLoginData.user);
      setVaultUnlocked(true);

      const activeMembership = tenantMemberships.find((m) => m.isActive);
      if (!activeMembership || activeMembership.tenantId !== selectedTenantId) {
        const result = await switchTenantApi(selectedTenantId);
        setAuth(result.accessToken, result.csrfToken, result.user);
      }

      useUiPreferencesStore.getState().set('lastActiveTenantId', selectedTenantId);
      navigate(buildRedirect());
    } catch (err: unknown) {
      setError(extractApiError(err, 'Failed to select organization'));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setShowResend(false);
    setLoading(true);
    try {
      const data = await loginApi(email, password);

      // New unified MFA response
      if ('requiresMFA' in data && data.requiresMFA) {
        setTempToken(data.tempToken);
        setMfaMethods(data.methods);
        if (data.methods.length === 1) {
          if (data.methods[0] === 'totp') {
            setStep('totp');
          } else if (data.methods[0] === 'webauthn') {
            setStep('webauthn');
            handleWebAuthnAuth(data.tempToken);
          } else {
            setStep('sms');
            await requestSmsCodeApi(data.tempToken);
          }
        } else {
          setStep('mfa-choice');
        }
        setLoading(false);
        return;
      }

      // Tenant requires MFA but user has none configured
      if ('mfaSetupRequired' in data && data.mfaSetupRequired) {
        setTempToken(data.tempToken);
        setStep('mfa-setup');
        setLoading(false);
        try {
          const setupData = await mfaSetupInitApi(data.tempToken);
          setMfaSetupData(setupData);
        } catch {
          setError('Failed to initialize MFA setup');
        }
        return;
      }

      // Legacy TOTP-only response (backward compat)
      if ('requiresTOTP' in data && data.requiresTOTP) {
        setTempToken(data.tempToken);
        setStep('totp');
        setLoading(false);
        return;
      }

      if ('accessToken' in data) {
        completeLogin(data);
      }
    } catch (err: unknown) {
      setError(extractApiError(err, 'Login failed'));
      if ((err as { response?: { status?: number } })?.response?.status === 403) {
        setShowResend(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleTotpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await verifyTotpApi(tempToken, totpCode);
      completeLogin(data);
    } catch (err: unknown) {
      setError(extractApiError(err, 'Invalid code'));
    } finally {
      setLoading(false);
    }
  };

  const handleSmsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await verifySmsApi(tempToken, smsCode);
      completeLogin(data);
    } catch (err: unknown) {
      setError(extractApiError(err, 'Invalid code'));
    } finally {
      setLoading(false);
    }
  };

  const handleWebAuthnAuth = async (token?: string) => {
    const t = token || tempToken;
    setError('');
    setLoading(true);
    try {
      const options = await requestWebAuthnOptionsApi(t);
      const credential = await startAuthentication({ optionsJSON: options });
      const data = await verifyWebAuthnApi(t, credential);
      completeLogin(data);
    } catch (err: unknown) {
      if ((err as Error)?.name === 'NotAllowedError') {
        setError('Authentication was cancelled or timed out.');
      } else {
        setError(extractApiError(err, 'WebAuthn authentication failed.'));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleChooseMethod = async (method: string) => {
    setError('');
    if (method === 'totp') {
      setStep('totp');
    } else if (method === 'webauthn') {
      setStep('webauthn');
      handleWebAuthnAuth();
    } else {
      setSmsSending(true);
      try {
        await requestSmsCodeApi(tempToken);
        setStep('sms');
      } catch (err: unknown) {
        setError(extractApiError(err, 'Failed to send SMS code'));
      } finally {
        setSmsSending(false);
      }
    }
  };

  const handleBackToCredentials = () => {
    setStep('credentials');
    setTotpCode('');
    setSmsCode('');
    setTempToken('');
    setMfaMethods([]);
    setError('');
  };

  const handleBackToChoice = () => {
    setStep('mfa-choice');
    setTotpCode('');
    setSmsCode('');
    setError('');
  };

  const handleMfaSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await mfaSetupVerifyApi(tempToken, mfaSetupCode);
      completeLogin(data);
    } catch (err: unknown) {
      setError(extractApiError(err, 'Invalid code'));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    try {
      await resendVerificationEmail(email);
      setResendCountdown(60);
      setSuccess('Verification email sent! Check your inbox.');
      setError('');
      setShowResend(false);
    } catch {
      // Server always returns 200 for valid format
    }
  };

  const subtitle = (() => {
    switch (step) {
      case 'credentials': return 'Sign in to manage your connections';
      case 'mfa-choice': return 'Choose your verification method';
      case 'totp': return 'Enter the 6-digit code from your authenticator app';
      case 'sms': return 'Enter the 6-digit code sent to your phone';
      case 'webauthn': return 'Verify your identity with your security key or passkey';
      case 'mfa-setup': return 'Your organization requires two-factor authentication';
      case 'tenant-select': return 'Select the organization you want to work in';
    }
  })();

  const canGoBackToChoice = mfaMethods.length > 1;

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        background: (theme) => `radial-gradient(ellipse at 50% 40%, ${theme.palette.primary.main}0A 0%, ${theme.palette.background.default} 70%)`,
      }}
    >
      <Box sx={{
        width: 400,
        maxWidth: '90vw',
        bgcolor: 'background.paper',
        border: 1, borderColor: 'divider',
        borderRadius: 4,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        p: 3,
      }}>
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1 }}>
            <Box sx={{ width: 24, height: 3, borderRadius: 1, bgcolor: 'primary.main' }} />
          </Box>
          <Typography variant="h5" gutterBottom align="center" sx={{
            fontFamily: (theme) => theme.typography.h5.fontFamily,
            fontSize: '2.25rem',
            color: 'text.primary',
            fontWeight: 400,
          }}>
            Arsenale
          </Typography>
          <Typography variant="body2" align="center" mb={3} sx={{ color: 'text.secondary' }}>
            {subtitle}
          </Typography>
          {success && <Alert severity="success" sx={{ mb: 2, bgcolor: (theme) => `${theme.palette.primary.main}14`, color: 'primary.main', border: (theme) => `1px solid ${theme.palette.primary.main}26`, '& .MuiAlert-icon': { color: 'primary.main' } }}>{success}</Alert>}
          {error && <Alert severity="error" sx={{ mb: 2, bgcolor: (theme) => `${theme.palette.error.main}14`, color: 'error.light', border: (theme) => `1px solid ${theme.palette.error.main}26`, '& .MuiAlert-icon': { color: 'error.light' } }}>{error}</Alert>}
          {showResend && (
            <Button
              fullWidth
              variant="outlined"
              size="small"
              onClick={handleResend}
              disabled={resendCountdown > 0}
              sx={{ mb: 2, borderColor: 'divider', color: 'text.secondary', '&:hover': { borderColor: 'primary.main', color: 'text.primary' } }}
            >
              {resendCountdown > 0
                ? `Resend verification email (${resendCountdown}s)`
                : 'Resend verification email'}
            </Button>
          )}

          {step === 'credentials' && (
            <Box component="form" onSubmit={handleSubmit}>
              <OAuthButtons mode="login" />
              <TextField
                fullWidth
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                margin="normal"
                required
                sx={{ '& .MuiOutlinedInput-root': { bgcolor: 'background.default', '& fieldset': { borderColor: 'divider' }, '&:hover fieldset': { borderColor: 'primary.main' }, '&.Mui-focused fieldset': { borderColor: 'primary.main' } }, '& .MuiInputLabel-root': { color: 'text.secondary' }, '& .MuiOutlinedInput-input': { color: 'text.primary' } }}
              />
              <TextField
                fullWidth
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                margin="normal"
                required
                sx={{ '& .MuiOutlinedInput-root': { bgcolor: 'background.default', '& fieldset': { borderColor: 'divider' }, '&:hover fieldset': { borderColor: 'primary.main' }, '&.Mui-focused fieldset': { borderColor: 'primary.main' } }, '& .MuiInputLabel-root': { color: 'text.secondary' }, '& .MuiOutlinedInput-input': { color: 'text.primary' } }}
              />
              <Box sx={{ textAlign: 'right', mt: -0.5 }}>
                <Link component={RouterLink} to="/forgot-password" variant="body2" sx={{ color: 'primary.main', '&:hover': { color: 'secondary.main' } }}>
                  Forgot password?
                </Link>
              </Box>
              <Button
                fullWidth
                type="submit"
                variant="contained"
                disabled={loading}
                sx={{ mt: 2, mb: 1, bgcolor: 'primary.main', color: (theme) => theme.palette.getContrastText(theme.palette.primary.main), fontWeight: 600, '&:hover': { bgcolor: 'secondary.main' }, '&.Mui-disabled': { bgcolor: (theme) => `${theme.palette.primary.main}4D`, color: (theme) => theme.palette.getContrastText(theme.palette.primary.main) } }}
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>
              {ldapEnabled && (
                <Typography variant="caption" align="center" display="block" sx={{ mb: 0.5, color: 'text.disabled' }}>
                  {ldapProviderName} directory login is available. Use your directory credentials above.
                </Typography>
              )}
              <Typography variant="body2" align="center" sx={{ color: 'text.secondary' }}>
                Don't have an account?{' '}
                <Link component={RouterLink} to="/register" sx={{ color: 'primary.main', '&:hover': { color: 'secondary.main' } }}>Sign up</Link>
              </Typography>
            </Box>
          )}

          {step === 'mfa-choice' && (
            <Box>
              <Stack spacing={1}>
                {mfaMethods.includes('totp') && (
                  <Button fullWidth variant="outlined" onClick={() => handleChooseMethod('totp')} sx={{ borderColor: 'divider', color: 'text.secondary', '&:hover': { borderColor: 'primary.main', color: 'text.primary' } }}>
                    Authenticator App
                  </Button>
                )}
                {mfaMethods.includes('sms') && (
                  <Button
                    fullWidth
                    variant="outlined"
                    onClick={() => handleChooseMethod('sms')}
                    disabled={smsSending}
                    sx={{ borderColor: 'divider', color: 'text.secondary', '&:hover': { borderColor: 'primary.main', color: 'text.primary' } }}
                  >
                    {smsSending ? 'Sending...' : 'SMS Code'}
                  </Button>
                )}
                {mfaMethods.includes('webauthn') && (
                  <Button
                    fullWidth
                    variant="outlined"
                    onClick={() => handleChooseMethod('webauthn')}
                    disabled={loading}
                    sx={{ borderColor: 'divider', color: 'text.secondary', '&:hover': { borderColor: 'primary.main', color: 'text.primary' } }}
                  >
                    Security Key / Passkey
                  </Button>
                )}
              </Stack>
              <Button fullWidth variant="text" onClick={handleBackToCredentials} sx={{ mt: 1, color: 'text.secondary', '&:hover': { color: 'text.primary' } }}>
                Back
              </Button>
            </Box>
          )}

          {step === 'totp' && (
            <Box component="form" onSubmit={handleTotpSubmit}>
              <TextField
                fullWidth
                label="Authenticator Code"
                type="text"
                inputMode="numeric"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                margin="normal"
                required
                autoFocus
                placeholder="000000"
                slotProps={{ htmlInput: { maxLength: 6 } }}
                sx={{ '& .MuiOutlinedInput-root': { bgcolor: 'background.default', '& fieldset': { borderColor: 'divider' }, '&:hover fieldset': { borderColor: 'primary.main' }, '&.Mui-focused fieldset': { borderColor: 'primary.main' } }, '& .MuiInputLabel-root': { color: 'text.secondary' }, '& .MuiOutlinedInput-input': { color: 'text.primary' } }}
              />
              <Button
                fullWidth
                type="submit"
                variant="contained"
                disabled={loading || totpCode.length !== 6}
                sx={{ mt: 2, mb: 1, bgcolor: 'primary.main', color: (theme) => theme.palette.getContrastText(theme.palette.primary.main), fontWeight: 600, '&:hover': { bgcolor: 'secondary.main' }, '&.Mui-disabled': { bgcolor: (theme) => `${theme.palette.primary.main}4D`, color: (theme) => theme.palette.getContrastText(theme.palette.primary.main) } }}
              >
                {loading ? 'Verifying...' : 'Verify'}
              </Button>
              <Button
                fullWidth
                variant="text"
                onClick={canGoBackToChoice ? handleBackToChoice : handleBackToCredentials}
                sx={{ mb: 1, color: 'text.secondary', '&:hover': { color: 'text.primary' } }}
              >
                Back
              </Button>
            </Box>
          )}

          {step === 'sms' && (
            <Box component="form" onSubmit={handleSmsSubmit}>
              <Alert severity="info" sx={{ mb: 2, bgcolor: (theme) => `${theme.palette.primary.main}0F`, color: 'primary.main', border: (theme) => `1px solid ${theme.palette.primary.main}1F`, '& .MuiAlert-icon': { color: 'primary.main' } }}>
                A verification code has been sent to your phone.
              </Alert>
              <TextField
                fullWidth
                label="SMS Code"
                type="text"
                inputMode="numeric"
                value={smsCode}
                onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                margin="normal"
                required
                autoFocus
                placeholder="000000"
                slotProps={{ htmlInput: { maxLength: 6 } }}
                sx={{ '& .MuiOutlinedInput-root': { bgcolor: 'background.default', '& fieldset': { borderColor: 'divider' }, '&:hover fieldset': { borderColor: 'primary.main' }, '&.Mui-focused fieldset': { borderColor: 'primary.main' } }, '& .MuiInputLabel-root': { color: 'text.secondary' }, '& .MuiOutlinedInput-input': { color: 'text.primary' } }}
              />
              <Button
                fullWidth
                type="submit"
                variant="contained"
                disabled={loading || smsCode.length !== 6}
                sx={{ mt: 2, mb: 1, bgcolor: 'primary.main', color: (theme) => theme.palette.getContrastText(theme.palette.primary.main), fontWeight: 600, '&:hover': { bgcolor: 'secondary.main' }, '&.Mui-disabled': { bgcolor: (theme) => `${theme.palette.primary.main}4D`, color: (theme) => theme.palette.getContrastText(theme.palette.primary.main) } }}
              >
                {loading ? 'Verifying...' : 'Verify'}
              </Button>
              <Button
                fullWidth
                variant="text"
                onClick={canGoBackToChoice ? handleBackToChoice : handleBackToCredentials}
                sx={{ mb: 1, color: 'text.secondary', '&:hover': { color: 'text.primary' } }}
              >
                Back
              </Button>
            </Box>
          )}

          {step === 'webauthn' && (
            <Box>
              <Alert severity="info" sx={{ mb: 2, bgcolor: (theme) => `${theme.palette.primary.main}0F`, color: 'primary.main', border: (theme) => `1px solid ${theme.palette.primary.main}1F`, '& .MuiAlert-icon': { color: 'primary.main' } }}>
                {loading
                  ? 'Please interact with your security key or approve the passkey prompt...'
                  : 'Click below to authenticate with your security key or passkey.'}
              </Alert>
              {loading && (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                  <CircularProgress sx={{ color: 'primary.main' }} />
                </Box>
              )}
              {!loading && (
                <Button
                  fullWidth
                  variant="contained"
                  onClick={() => handleWebAuthnAuth()}
                  sx={{ mb: 1, bgcolor: 'primary.main', color: (theme) => theme.palette.getContrastText(theme.palette.primary.main), fontWeight: 600, '&:hover': { bgcolor: 'secondary.main' } }}
                >
                  Retry Authentication
                </Button>
              )}
              <Button
                fullWidth
                variant="text"
                onClick={canGoBackToChoice ? handleBackToChoice : handleBackToCredentials}
                sx={{ mb: 1, color: 'text.secondary', '&:hover': { color: 'text.primary' } }}
              >
                Back
              </Button>
            </Box>
          )}

          {step === 'mfa-setup' && (
            <Box>
              {!mfaSetupData ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                  <CircularProgress sx={{ color: 'primary.main' }} />
                </Box>
              ) : (
                <Box component="form" onSubmit={handleMfaSetupSubmit}>
                  <Alert severity="warning" sx={{ mb: 2, bgcolor: (theme) => `${theme.palette.warning.main}14`, color: 'warning.light', border: (theme) => `1px solid ${theme.palette.warning.main}26`, '& .MuiAlert-icon': { color: 'warning.light' } }}>
                    Your organization requires MFA. Set up an authenticator app to continue signing in.
                  </Alert>
                  <Typography variant="body2" sx={{ mb: 1, color: 'text.primary' }}>
                    1. Scan this QR code with your authenticator app:
                  </Typography>
                  <Box sx={{ p: 2, bgcolor: '#ffffff', borderRadius: 1, display: 'flex', justifyContent: 'center', mb: 2 }}>
                    <QRCodeSVG value={mfaSetupData.otpauthUri} size={180} />
                  </Box>
                  <Typography variant="body2" sx={{ mb: 1, color: 'text.primary' }}>
                    2. Or enter this code manually:
                  </Typography>
                  <TextField
                    fullWidth
                    value={mfaSetupData.secret}
                    size="small"
                    slotProps={{ input: { readOnly: true } }}
                    sx={{ mb: 2, '& .MuiOutlinedInput-root': { bgcolor: 'background.default', fontFamily: "'JetBrains Mono', monospace", '& fieldset': { borderColor: 'divider' } }, '& .MuiOutlinedInput-input': { color: 'text.primary' } }}
                  />
                  <Typography variant="body2" sx={{ mb: 1, color: 'text.primary' }}>
                    3. Enter the 6-digit code from your app:
                  </Typography>
                  <TextField
                    fullWidth
                    label="6-digit code"
                    type="text"
                    inputMode="numeric"
                    value={mfaSetupCode}
                    onChange={(e) => setMfaSetupCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    margin="normal"
                    required
                    autoFocus
                    placeholder="000000"
                    slotProps={{ htmlInput: { maxLength: 6 } }}
                    sx={{ '& .MuiOutlinedInput-root': { bgcolor: 'background.default', '& fieldset': { borderColor: 'divider' }, '&:hover fieldset': { borderColor: 'primary.main' }, '&.Mui-focused fieldset': { borderColor: 'primary.main' } }, '& .MuiInputLabel-root': { color: 'text.secondary' }, '& .MuiOutlinedInput-input': { color: 'text.primary' } }}
                  />
                  <Button
                    fullWidth
                    type="submit"
                    variant="contained"
                    disabled={loading || mfaSetupCode.length !== 6}
                    sx={{ mt: 2, mb: 1, bgcolor: 'primary.main', color: (theme) => theme.palette.getContrastText(theme.palette.primary.main), fontWeight: 600, '&:hover': { bgcolor: 'secondary.main' }, '&.Mui-disabled': { bgcolor: (theme) => `${theme.palette.primary.main}4D`, color: (theme) => theme.palette.getContrastText(theme.palette.primary.main) } }}
                  >
                    {loading ? 'Verifying...' : 'Enable MFA & Sign In'}
                  </Button>
                  <Button fullWidth variant="text" onClick={handleBackToCredentials} sx={{ mb: 1, color: 'text.secondary', '&:hover': { color: 'text.primary' } }}>
                    Back
                  </Button>
                </Box>
              )}
            </Box>
          )}

          {step === 'tenant-select' && (
            <Box>
              <List disablePadding>
                {tenantMemberships.map((m) => (
                  <ListItemButton
                    key={m.tenantId}
                    selected={m.tenantId === selectedTenantId}
                    onClick={() => setSelectedTenantId(m.tenantId)}
                    sx={{
                      borderRadius: 1,
                      mb: 0.5,
                      bgcolor: 'transparent',
                      border: '1px solid transparent',
                      '&:hover': { bgcolor: 'background.default', borderColor: 'divider' },
                      '&.Mui-selected': { bgcolor: (theme) => `${theme.palette.primary.main}0F`, borderColor: (theme) => `${theme.palette.primary.main}33`, '&:hover': { bgcolor: (theme) => `${theme.palette.primary.main}1A` } },
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 40 }}>
                      <Business sx={{ color: 'text.secondary' }} />
                    </ListItemIcon>
                    <ListItemText primary={m.name} secondary={m.role} sx={{ '& .MuiListItemText-primary': { color: 'text.primary' }, '& .MuiListItemText-secondary': { color: 'text.disabled' } }} />
                    {m.tenantId === selectedTenantId && (
                      <CheckCircle fontSize="small" sx={{ color: 'primary.main' }} />
                    )}
                  </ListItemButton>
                ))}
              </List>
              <Button
                fullWidth
                variant="contained"
                onClick={handleTenantConfirm}
                disabled={loading || !selectedTenantId}
                sx={{ mt: 2, mb: 1, bgcolor: 'primary.main', color: (theme) => theme.palette.getContrastText(theme.palette.primary.main), fontWeight: 600, '&:hover': { bgcolor: 'secondary.main' }, '&.Mui-disabled': { bgcolor: (theme) => `${theme.palette.primary.main}4D`, color: (theme) => theme.palette.getContrastText(theme.palette.primary.main) } }}
              >
                {loading ? 'Selecting...' : 'Continue'}
              </Button>
            </Box>
          )}
      </Box>
    </Box>
  );
}
