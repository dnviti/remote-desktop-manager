import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Card, CardContent, TextField, Button, Typography, Alert } from '@mui/material';
import { setupVaultPassword } from '../api/oauth.api';
import { useVaultStore } from '../store/vaultStore';
import { useAuthStore } from '../store/authStore';
import { extractApiError } from '../utils/apiError';

export default function VaultSetupPage() {
  const [vaultPassword, setVaultPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const setVaultUnlocked = useVaultStore((s) => s.setUnlocked);
  const updateUser = useAuthStore((s) => s.updateUser);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (vaultPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (vaultPassword.length < 8) {
      setError('Vault password must be at least 8 characters');
      return;
    }

    setLoading(true);
    try {
      await setupVaultPassword(vaultPassword);
      setVaultUnlocked(true);
      updateUser({ vaultSetupComplete: true });
      navigate('/', { replace: true });
    } catch (err: unknown) {
      setError(extractApiError(err, 'Failed to set up vault'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      bgcolor: '#08080a',
      background: 'radial-gradient(ellipse at 50% 0%, rgba(0,229,160,0.03) 0%, #08080a 70%)',
    }}>
      <Card sx={{
        width: 450,
        maxWidth: '90vw',
        bgcolor: '#0f0f12',
        border: '1px solid rgba(35,35,40,0.6)',
        borderRadius: 4,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}>
        <CardContent sx={{ p: 4 }}>
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
            <Box sx={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              bgcolor: '#00e5a0',
              boxShadow: '0 0 8px rgba(0,229,160,0.4)',
            }} />
          </Box>
          <Typography variant="h4" gutterBottom align="center" sx={{
            fontFamily: '"Playfair Display", Georgia, "Times New Roman", serif',
            color: '#f4f4f5',
            fontWeight: 600,
            letterSpacing: '-0.01em',
          }}>
            Set Up Your Vault
          </Typography>
          <Typography variant="body2" align="center" sx={{ mb: 1, color: '#a1a1aa' }}>
            Your vault encrypts all saved connection credentials.
          </Typography>
          <Typography variant="body2" align="center" sx={{ mb: 3, color: '#a1a1aa' }}>
            This vault password is separate from your OAuth login and cannot be recovered if lost.
          </Typography>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

          <Box component="form" onSubmit={handleSubmit}>
            <TextField
              fullWidth
              label="Vault Password"
              type="password"
              value={vaultPassword}
              onChange={(e) => setVaultPassword(e.target.value)}
              margin="normal"
              required
              helperText="Min 8 characters. This password encrypts your saved credentials."
              sx={{
                '& .MuiOutlinedInput-root': {
                  bgcolor: '#161619',
                  '& fieldset': { borderColor: 'rgba(35,35,40,0.6)' },
                  '&:hover fieldset': { borderColor: 'rgba(55,55,60,0.8)' },
                  '&.Mui-focused fieldset': { borderColor: '#00e5a0' },
                },
                '& .MuiInputLabel-root': { color: '#a1a1aa' },
                '& .MuiInputBase-input': { color: '#f4f4f5' },
                '& .MuiFormHelperText-root': { color: '#a1a1aa' },
              }}
            />
            <TextField
              fullWidth
              label="Confirm Vault Password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              margin="normal"
              required
              sx={{
                '& .MuiOutlinedInput-root': {
                  bgcolor: '#161619',
                  '& fieldset': { borderColor: 'rgba(35,35,40,0.6)' },
                  '&:hover fieldset': { borderColor: 'rgba(55,55,60,0.8)' },
                  '&.Mui-focused fieldset': { borderColor: '#00e5a0' },
                },
                '& .MuiInputLabel-root': { color: '#a1a1aa' },
                '& .MuiInputBase-input': { color: '#f4f4f5' },
              }}
            />
            <Button
              fullWidth
              type="submit"
              variant="contained"
              disabled={loading}
              sx={{
                mt: 3,
                py: 1.4,
                bgcolor: '#00e5a0',
                color: '#08080a',
                fontWeight: 600,
                textTransform: 'none',
                fontSize: '0.95rem',
                borderRadius: 2,
                '&:hover': { bgcolor: '#00cc8e' },
                '&.Mui-disabled': { bgcolor: 'rgba(0,229,160,0.3)', color: 'rgba(8,8,10,0.5)' },
              }}
            >
              {loading ? 'Setting up...' : 'Set Vault Password'}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
