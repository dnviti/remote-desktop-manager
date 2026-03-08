import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Card, CardContent, TextField, Button, Typography, Alert } from '@mui/material';
import { setupVaultPassword } from '../api/oauth.api';
import { useVaultStore } from '../store/vaultStore';
import { useAuthStore } from '../store/authStore';

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
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to set up vault';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Card sx={{ width: 450, maxWidth: '90vw' }}>
        <CardContent>
          <Typography variant="h5" gutterBottom align="center">
            Set Up Your Vault
          </Typography>
          <Typography variant="body2" color="text.secondary" align="center" sx={{ mb: 1 }}>
            Your vault encrypts all saved connection credentials.
          </Typography>
          <Typography variant="body2" color="text.secondary" align="center" sx={{ mb: 3 }}>
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
            />
            <TextField
              fullWidth
              label="Confirm Vault Password"
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
              sx={{ mt: 2 }}
            >
              {loading ? 'Setting up...' : 'Set Vault Password'}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
