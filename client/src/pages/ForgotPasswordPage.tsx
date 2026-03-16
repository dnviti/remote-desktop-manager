import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box, Card, CardContent, TextField, Button, Typography, Alert, Link,
} from '@mui/material';
import { forgotPasswordApi } from '../api/passwordReset.api';
import { extractApiError } from '../utils/apiError';

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
      setError(extractApiError(err, 'Request failed. Please try again.'));
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
        bgcolor: '#08080a',
        background: 'radial-gradient(ellipse at 50% 0%, rgba(0,229,160,0.04) 0%, #08080a 70%)',
      }}
    >
      <Card sx={{
        width: 400,
        maxWidth: '90vw',
        bgcolor: '#0f0f12',
        border: '1px solid rgba(35,35,40,0.6)',
        borderRadius: 4,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}>
        <CardContent sx={{ p: 4 }}>
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
            <Box sx={{ width: 32, height: 3, borderRadius: 1, bgcolor: '#00e5a0' }} />
          </Box>
          <Typography variant="h5" gutterBottom align="center" sx={{
            fontFamily: '"Instrument Serif", serif',
            fontSize: '1.75rem',
            color: '#f4f4f5',
          }}>
            Reset Password
          </Typography>

          {sent ? (
            <>
              <Alert severity="success" sx={{ mb: 2, bgcolor: 'rgba(0,229,160,0.08)', color: '#00e5a0', '& .MuiAlert-icon': { color: '#00e5a0' } }}>
                If an account exists with that email, a password reset link has been sent.
                Check your inbox and spam folder.
              </Alert>
              <Typography variant="body2" align="center">
                <Link component={RouterLink} to="/login" sx={{ color: '#00e5a0', '&:hover': { color: '#00cc8e' } }}>Back to Sign In</Link>
              </Typography>
            </>
          ) : (
            <>
              <Typography variant="body2" align="center" mb={3} sx={{ color: '#a1a1aa' }}>
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
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      bgcolor: '#161619',
                      color: '#f4f4f5',
                      '& fieldset': { borderColor: 'rgba(35,35,40,0.6)' },
                      '&:hover fieldset': { borderColor: 'rgba(55,55,60,0.8)' },
                      '&.Mui-focused fieldset': { borderColor: '#00e5a0' },
                    },
                    '& .MuiInputLabel-root': { color: '#a1a1aa' },
                    '& .MuiInputLabel-root.Mui-focused': { color: '#00e5a0' },
                  }}
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
                    '&:hover': { bgcolor: '#00cc8e' },
                    '&.Mui-disabled': { bgcolor: 'rgba(0,229,160,0.3)', color: 'rgba(8,8,10,0.5)' },
                  }}
                >
                  {loading ? 'Sending...' : 'Send Reset Link'}
                </Button>
                <Typography variant="body2" align="center">
                  <Link component={RouterLink} to="/login" sx={{ color: '#00e5a0', '&:hover': { color: '#00cc8e' } }}>Back to Sign In</Link>
                </Typography>
              </Box>
            </>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
