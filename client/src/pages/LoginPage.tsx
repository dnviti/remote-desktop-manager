import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link as RouterLink, useSearchParams } from 'react-router-dom';
import {
  Box, Card, CardContent, TextField, Button, Typography, Alert, Link, Stack, CircularProgress,
} from '@mui/material';
import { QRCodeSVG } from 'qrcode.react';
import { loginApi, verifyTotpApi, requestSmsCodeApi, verifySmsApi, mfaSetupInitApi, mfaSetupVerifyApi } from '../api/auth.api';
import { resendVerificationEmail } from '../api/email.api';
import { useAuthStore } from '../store/authStore';
import { useVaultStore } from '../store/vaultStore';
import OAuthButtons from '../components/OAuthButtons';

type Step = 'credentials' | 'mfa-choice' | 'totp' | 'sms' | 'mfa-setup';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
  const countdownRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const setAuth = useAuthStore((s) => s.setAuth);
  const setVaultUnlocked = useVaultStore((s) => s.setUnlocked);

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
    const verifyError = searchParams.get('verifyError');
    if (verifyError) {
      setError(verifyError);
      searchParams.delete('verifyError');
      setSearchParams(searchParams, { replace: true });
    }
    const oauthError = searchParams.get('error');
    if (oauthError) {
      setError(decodeURIComponent(oauthError));
      searchParams.delete('error');
      setSearchParams(searchParams, { replace: true });
    }
  }, []);

  useEffect(() => {
    if (resendCountdown <= 0) {
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
  }, [resendCountdown > 0]);

  const completeLogin = (data: { accessToken: string; refreshToken: string; user: { id: string; email: string; username: string | null; avatarData: string | null } }) => {
    setAuth(data.accessToken, data.refreshToken, data.user);
    setVaultUnlocked(true);
    navigate('/');
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
      const axiosErr = err as { response?: { status?: number; data?: { error?: string } } };
      const msg = axiosErr?.response?.data?.error || 'Login failed';
      setError(msg);
      if (axiosErr?.response?.status === 403) {
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
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Invalid code';
      setError(msg);
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
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Invalid code';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleChooseMethod = async (method: string) => {
    setError('');
    if (method === 'totp') {
      setStep('totp');
    } else {
      setSmsSending(true);
      try {
        await requestSmsCodeApi(tempToken);
        setStep('sms');
      } catch (err: unknown) {
        const msg =
          (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
          'Failed to send SMS code';
        setError(msg);
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
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Invalid code';
      setError(msg);
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
      case 'mfa-setup': return 'Your organization requires two-factor authentication';
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
      }}
    >
      <Card sx={{ width: 400, maxWidth: '90vw' }}>
        <CardContent>
          <Typography variant="h5" gutterBottom align="center">
            Remote Desktop Manager
          </Typography>
          <Typography variant="body2" color="text.secondary" align="center" mb={3}>
            {subtitle}
          </Typography>
          {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {showResend && (
            <Button
              fullWidth
              variant="outlined"
              size="small"
              onClick={handleResend}
              disabled={resendCountdown > 0}
              sx={{ mb: 2 }}
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
              />
              <TextField
                fullWidth
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                margin="normal"
                required
              />
              <Button
                fullWidth
                type="submit"
                variant="contained"
                disabled={loading}
                sx={{ mt: 2, mb: 1 }}
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>
              <Typography variant="body2" align="center">
                Don't have an account?{' '}
                <Link component={RouterLink} to="/register">Sign up</Link>
              </Typography>
            </Box>
          )}

          {step === 'mfa-choice' && (
            <Box>
              <Stack spacing={1}>
                {mfaMethods.includes('totp') && (
                  <Button fullWidth variant="outlined" onClick={() => handleChooseMethod('totp')}>
                    Authenticator App
                  </Button>
                )}
                {mfaMethods.includes('sms') && (
                  <Button
                    fullWidth
                    variant="outlined"
                    onClick={() => handleChooseMethod('sms')}
                    disabled={smsSending}
                  >
                    {smsSending ? 'Sending...' : 'SMS Code'}
                  </Button>
                )}
              </Stack>
              <Button fullWidth variant="text" onClick={handleBackToCredentials} sx={{ mt: 1 }}>
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
              />
              <Button
                fullWidth
                type="submit"
                variant="contained"
                disabled={loading || totpCode.length !== 6}
                sx={{ mt: 2, mb: 1 }}
              >
                {loading ? 'Verifying...' : 'Verify'}
              </Button>
              <Button
                fullWidth
                variant="text"
                onClick={canGoBackToChoice ? handleBackToChoice : handleBackToCredentials}
                sx={{ mb: 1 }}
              >
                Back
              </Button>
            </Box>
          )}

          {step === 'sms' && (
            <Box component="form" onSubmit={handleSmsSubmit}>
              <Alert severity="info" sx={{ mb: 2 }}>
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
              />
              <Button
                fullWidth
                type="submit"
                variant="contained"
                disabled={loading || smsCode.length !== 6}
                sx={{ mt: 2, mb: 1 }}
              >
                {loading ? 'Verifying...' : 'Verify'}
              </Button>
              <Button
                fullWidth
                variant="text"
                onClick={canGoBackToChoice ? handleBackToChoice : handleBackToCredentials}
                sx={{ mb: 1 }}
              >
                Back
              </Button>
            </Box>
          )}

          {step === 'mfa-setup' && (
            <Box>
              {!mfaSetupData ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                  <CircularProgress />
                </Box>
              ) : (
                <Box component="form" onSubmit={handleMfaSetupSubmit}>
                  <Alert severity="warning" sx={{ mb: 2 }}>
                    Your organization requires MFA. Set up an authenticator app to continue signing in.
                  </Alert>
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    1. Scan this QR code with your authenticator app:
                  </Typography>
                  <Box sx={{ p: 2, bgcolor: '#ffffff', borderRadius: 1, display: 'flex', justifyContent: 'center', mb: 2 }}>
                    <QRCodeSVG value={mfaSetupData.otpauthUri} size={180} />
                  </Box>
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    2. Or enter this code manually:
                  </Typography>
                  <TextField
                    fullWidth
                    value={mfaSetupData.secret}
                    size="small"
                    slotProps={{ input: { readOnly: true } }}
                    sx={{ mb: 2 }}
                  />
                  <Typography variant="body2" sx={{ mb: 1 }}>
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
                  />
                  <Button
                    fullWidth
                    type="submit"
                    variant="contained"
                    disabled={loading || mfaSetupCode.length !== 6}
                    sx={{ mt: 2, mb: 1 }}
                  >
                    {loading ? 'Verifying...' : 'Enable MFA & Sign In'}
                  </Button>
                  <Button fullWidth variant="text" onClick={handleBackToCredentials} sx={{ mb: 1 }}>
                    Back
                  </Button>
                </Box>
              )}
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
