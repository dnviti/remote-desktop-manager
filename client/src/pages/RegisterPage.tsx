import { useState, useEffect, useRef } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Box, TextField, Button, Typography, Alert, Link,
} from '@mui/material';
import { registerApi, getPublicConfig } from '../api/auth.api';
import { resendVerificationEmail } from '../api/email.api';
import OAuthButtons from '../components/OAuthButtons';
import PasswordStrengthMeter from '../components/common/PasswordStrengthMeter';
import { extractApiError } from '../utils/apiError';

export default function RegisterPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [resendCountdown, setResendCountdown] = useState(0);
  const [signupDisabled, setSignupDisabled] = useState(false);
  const countdownRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    getPublicConfig()
      .then((cfg) => { if (!cfg.selfSignupEnabled) setSignupDisabled(true); })
      .catch(() => { /* fail-open: server guard is authoritative */ });
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // eslint-disable-next-line security/detect-possible-timing-attacks -- client-side UI validation, not a security comparison
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 10) {
      setError('Password must be at least 10 characters');
      return;
    }

    setLoading(true);
    try {
      const result = await registerApi(email, password);
      if (!result.emailVerifyRequired) {
        navigate('/login?registered=true');
        return;
      }
      setRegisteredEmail(email);
      setSuccessMessage(result.message);
      if (result.recoveryKey) setRecoveryKey(result.recoveryKey);
      setRegistered(true);
      setResendCountdown(60);
    } catch (err: unknown) {
      setError(extractApiError(err, 'Registration failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    try {
      await resendVerificationEmail(registeredEmail);
      setResendCountdown(60);
    } catch {
      // Server always returns 200 for valid format
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: '#08080a',
        background: 'radial-gradient(ellipse at 50% 40%, rgba(0,229,160,0.04) 0%, #08080a 70%)',
      }}
    >
      <Box sx={{
        width: 400,
        maxWidth: '90vw',
        bgcolor: '#0f0f12',
        border: '1px solid rgba(35,35,40,0.6)',
        borderRadius: 4,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        p: 3,
      }}>
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1 }}>
            <Box sx={{ width: 24, height: 3, borderRadius: 1, bgcolor: '#00e5a0' }} />
          </Box>
          <Typography variant="h5" gutterBottom align="center" sx={{
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontSize: '2.25rem',
            color: '#f4f4f5',
            fontWeight: 400,
          }}>
            Create Account
          </Typography>

          {signupDisabled ? (
            <>
              <Alert severity="info" sx={{
                mb: 2,
                bgcolor: 'rgba(59,130,246,0.08)',
                color: '#93c5fd',
                border: '1px solid rgba(59,130,246,0.15)',
                '& .MuiAlert-icon': { color: '#93c5fd' },
              }}>
                Public registration is currently disabled. Please contact your organization administrator to get an account.
              </Alert>
              <Typography variant="body2" align="center" sx={{ color: '#a1a1aa' }}>
                Already have an account?{' '}
                <Link component={RouterLink} to="/login" sx={{ color: '#00e5a0', '&:hover': { color: '#00cc8e' } }}>Sign in</Link>
              </Typography>
            </>
          ) : registered ? (
            <>
              <Alert severity="success" sx={{
                mb: 2,
                bgcolor: 'rgba(0,229,160,0.08)',
                color: '#00e5a0',
                border: '1px solid rgba(0,229,160,0.15)',
                '& .MuiAlert-icon': { color: '#00e5a0' },
              }}>
                {successMessage}
              </Alert>
              {recoveryKey && (
                <Alert severity="warning" sx={{
                  mb: 2,
                  bgcolor: 'rgba(234,179,8,0.08)',
                  color: '#fde68a',
                  border: '1px solid rgba(234,179,8,0.15)',
                  '& .MuiAlert-icon': { color: '#fde68a' },
                }}>
                  <Typography variant="subtitle2" gutterBottom sx={{ color: '#fde68a' }}>
                    Save your vault recovery key:
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      fontFamily: 'monospace',
                      wordBreak: 'break-all',
                      bgcolor: '#161619',
                      color: '#f4f4f5',
                      p: 1,
                      borderRadius: 1,
                      border: '1px solid #232328',
                      userSelect: 'all',
                    }}
                  >
                    {recoveryKey}
                  </Typography>
                  <Typography variant="caption" sx={{ display: 'block', mt: 1, color: '#a1a1aa' }}>
                    This key allows you to recover your encrypted vault if you forget your password.
                    Store it in a safe place. It is shown only once.
                  </Typography>
                </Alert>
              )}
              <Typography variant="body2" align="center" sx={{ mb: 2, color: '#a1a1aa' }}>
                Didn't receive the email? Check your spam folder or resend it.
              </Typography>
              <Button
                fullWidth
                variant="outlined"
                onClick={handleResend}
                disabled={resendCountdown > 0}
                sx={{
                  mb: 1,
                  borderColor: '#232328',
                  color: '#a1a1aa',
                  '&:hover': {
                    borderColor: '#00e5a0',
                    color: '#00e5a0',
                    bgcolor: 'rgba(0,229,160,0.06)',
                  },
                  '&.Mui-disabled': {
                    borderColor: 'rgba(35,35,40,0.6)',
                    color: '#52525b',
                  },
                }}
              >
                {resendCountdown > 0
                  ? `Resend verification email (${resendCountdown}s)`
                  : 'Resend verification email'}
              </Button>
              <Typography variant="body2" align="center" sx={{ color: '#a1a1aa' }}>
                <Link component={RouterLink} to="/login" sx={{ color: '#00e5a0', '&:hover': { color: '#00cc8e' } }}>Go to Sign In</Link>
              </Typography>
            </>
          ) : (
            <>
              <Typography variant="body2" align="center" mb={3} sx={{ color: '#a1a1aa' }}>
                Your password is also your vault key
              </Typography>
              {error && <Alert severity="error" sx={{
                mb: 2,
                bgcolor: 'rgba(239,68,68,0.08)',
                color: '#fca5a5',
                border: '1px solid rgba(239,68,68,0.15)',
                '& .MuiAlert-icon': { color: '#fca5a5' },
              }}>{error}</Alert>}
              <Box component="form" onSubmit={handleSubmit}>
                <OAuthButtons mode="register" />
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
                  helperText="Min 10 characters. This password also encrypts your saved credentials."
                />
                <PasswordStrengthMeter password={password} />
                <TextField
                  fullWidth
                  label="Confirm Password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  margin="normal"
                  required
                />
                <Button
                  fullWidth
                  type="submit"
                  variant="contained"
                  disabled={loading}
                  sx={{
                    mt: 2,
                    mb: 1,
                    bgcolor: '#00e5a0',
                    color: '#08080a',
                    fontWeight: 600,
                    '&:hover': {
                      bgcolor: '#00cc8e',
                    },
                    '&.Mui-disabled': {
                      bgcolor: 'rgba(0,229,160,0.3)',
                      color: 'rgba(8,8,10,0.5)',
                    },
                  }}
                >
                  {loading ? 'Creating account...' : 'Sign Up'}
                </Button>
                <Typography variant="body2" align="center" sx={{ color: '#a1a1aa' }}>
                  Already have an account?{' '}
                  <Link component={RouterLink} to="/login" sx={{ color: '#00e5a0', '&:hover': { color: '#00cc8e' } }}>Sign in</Link>
                </Typography>
              </Box>
            </>
          )}
      </Box>
    </Box>
  );
}
