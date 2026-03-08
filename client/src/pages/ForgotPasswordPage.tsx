import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box, Card, CardContent, TextField, Button, Typography, Alert, Link,
} from '@mui/material';
import { forgotPasswordApi } from '../api/passwordReset.api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await forgotPasswordApi(email);
      setSent(true);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Request failed. Please try again.';
      setError(msg);
    } finally {
      setLoading(false);
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
            Reset Password
          </Typography>

          {sent ? (
            <>
              <Alert severity="success" sx={{ mb: 2 }}>
                If an account exists with that email, a password reset link has been sent.
                Check your inbox and spam folder.
              </Alert>
              <Typography variant="body2" align="center">
                <Link component={RouterLink} to="/login">Back to Sign In</Link>
              </Typography>
            </>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary" align="center" mb={3}>
                Enter your email address and we'll send you a link to reset your password.
              </Typography>
              {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
              <Box component="form" onSubmit={handleSubmit}>
                <TextField
                  fullWidth
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  margin="normal"
                  required
                  autoFocus
                />
                <Button
                  fullWidth
                  type="submit"
                  variant="contained"
                  disabled={loading}
                  sx={{ mt: 2, mb: 1 }}
                >
                  {loading ? 'Sending...' : 'Send Reset Link'}
                </Button>
                <Typography variant="body2" align="center">
                  <Link component={RouterLink} to="/login">Back to Sign In</Link>
                </Typography>
              </Box>
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
