import { useState } from 'react';
import { Box, Typography, TextField, Button, Alert, Paper } from '@mui/material';
import { Lock as LockIcon } from '@mui/icons-material';
import { unlockVault } from '../../api/vault.api';
import { logoutApi } from '../../api/auth.api';
import { useVaultStore } from '../../store/vaultStore';
import { useAuthStore } from '../../store/authStore';

export default function VaultLockedOverlay() {
  const unlocked = useVaultStore((s) => s.unlocked);
  const initialized = useVaultStore((s) => s.initialized);
  const setVaultUnlocked = useVaultStore((s) => s.setUnlocked);
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const authLogout = useAuthStore((s) => s.logout);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (unlocked || !initialized) return null;

  const handleSubmit = async () => {
    setError('');
    setLoading(true);
    try {
      await unlockVault(password);
      setVaultUnlocked(true);
      setPassword('');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to unlock vault';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    if (refreshToken) {
      try { await logoutApi(refreshToken); } catch {}
    }
    authLogout();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) handleSubmit();
  };

  return (
    <Box
      sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
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
          Your vault was locked due to inactivity timeout.
          Enter your password to unlock and resume.
        </Typography>
        {error && (
          <Alert severity="error" sx={{ mb: 2, textAlign: 'left' }}>
            {error}
          </Alert>
        )}
        <TextField
          autoFocus
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={handleKeyDown}
          fullWidth
          margin="normal"
        />
        <Button
          onClick={handleSubmit}
          variant="contained"
          fullWidth
          disabled={loading}
          sx={{ mt: 1 }}
        >
          {loading ? 'Unlocking...' : 'Unlock Vault'}
        </Button>
        <Button
          onClick={handleLogout}
          variant="text"
          fullWidth
          color="inherit"
          sx={{ mt: 1 }}
        >
          Logout
        </Button>
      </Paper>
    </Box>
  );
}
