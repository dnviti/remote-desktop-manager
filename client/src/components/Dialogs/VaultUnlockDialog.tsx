import { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Alert,
} from '@mui/material';
import { unlockVault } from '../../api/vault.api';
import { useVaultStore } from '../../store/vaultStore';

interface VaultUnlockDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function VaultUnlockDialog({ open, onClose }: VaultUnlockDialogProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const setVaultUnlocked = useVaultStore((s) => s.setUnlocked);

  const handleSubmit = async () => {
    setError('');
    setLoading(true);
    try {
      await unlockVault(password);
      setVaultUnlocked(true);
      setPassword('');
      onClose();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to unlock vault';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Unlock Vault</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
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
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} variant="contained" disabled={loading}>
          {loading ? 'Unlocking...' : 'Unlock'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
