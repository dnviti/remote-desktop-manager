import { useState, useEffect, useRef } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import {
  Box, Card, CardContent, TextField, Button, Typography, Alert, Link,
} from '@mui/material';
import { registerApi } from '../api/auth.api';
import { resendVerificationEmail } from '../api/email.api';
import OAuthButtons from '../components/OAuthButtons';

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
  const [resendCountdown, setResendCountdown] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval>>(undefined);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
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
      setRegistered(true);
      setResendCountdown(60);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Registration failed';
      setError(msg);
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
      }}
    >
      <Card sx={{ width: 400, maxWidth: '90vw' }}>
        <CardContent>
          <Typography variant="h5" gutterBottom align="center">
            Create Account
          </Typography>

          {registered ? (
            <>
              <Alert severity="success" sx={{ mb: 2 }}>
                {successMessage}
              </Alert>
              <Typography variant="body2" align="center" sx={{ mb: 2 }}>
                Didn't receive the email? Check your spam folder or resend it.
              </Typography>
              <Button
                fullWidth
                variant="outlined"
                onClick={handleResend}
                disabled={resendCountdown > 0}
                sx={{ mb: 1 }}
              >
                {resendCountdown > 0
                  ? `Resend verification email (${resendCountdown}s)`
                  : 'Resend verification email'}
              </Button>
              <Typography variant="body2" align="center">
                <Link component={RouterLink} to="/login">Go to Sign In</Link>
              </Typography>
            </>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary" align="center" mb={3}>
                Your password is also your vault key
              </Typography>
              {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
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
                  helperText="Min 8 characters. This password also encrypts your saved credentials."
                />
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
                  sx={{ mt: 2, mb: 1 }}
                >
                  {loading ? 'Creating account...' : 'Sign Up'}
                </Button>
                <Typography variant="body2" align="center">
                  Already have an account?{' '}
                  <Link component={RouterLink} to="/login">Sign in</Link>
                </Typography>
              </Box>
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
