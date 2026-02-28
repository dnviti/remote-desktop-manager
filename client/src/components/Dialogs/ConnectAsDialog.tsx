import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  RadioGroup, Radio, FormControlLabel, Alert, Box,
} from '@mui/material';
import { useAuthStore } from '../../store/authStore';
import { useTabsStore } from '../../store/tabsStore';
import { ConnectionData } from '../../api/connections.api';

interface ConnectAsDialogProps {
  open: boolean;
  onClose: () => void;
  connection: ConnectionData | null;
}

export default function ConnectAsDialog({ open, onClose, connection }: ConnectAsDialogProps) {
  const openTab = useTabsStore((s) => s.openTab);
  const user = useAuthStore((s) => s.user);

  const [mode, setMode] = useState<'saved' | 'profile' | 'manual'>('saved');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  /* eslint-disable react-hooks/set-state-in-effect -- reset form state when dialog opens */
  useEffect(() => {
    if (open) {
      setMode('saved');
      setUsername('');
      setPassword('');
      setError('');
    }
  }, [open]);

  useEffect(() => {
    if (mode === 'profile') {
      setUsername(user?.username || user?.email || '');
      setPassword('');
    } else if (mode === 'manual') {
      setUsername('');
      setPassword('');
    }
    setError('');
  }, [mode, user]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleConnect = () => {
    if (!connection) return;

    if (mode === 'saved') {
      openTab(connection);
    } else {
      if (!username.trim()) {
        setError('Username is required');
        return;
      }
      if (!password) {
        setError('Password is required');
        return;
      }
      openTab(connection, { username: username.trim(), password });
    }
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Connect As &mdash; {connection?.name}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <RadioGroup
          value={mode}
          onChange={(e) => setMode(e.target.value as 'saved' | 'profile' | 'manual')}
        >
          <FormControlLabel
            value="saved"
            control={<Radio />}
            label="Use saved credentials"
          />
          <FormControlLabel
            value="profile"
            control={<Radio />}
            label="Use profile username"
          />
          <FormControlLabel
            value="manual"
            control={<Radio />}
            label="Enter credentials manually"
          />
        </RadioGroup>

        {mode !== 'saved' && (
          <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              size="small"
              fullWidth
              slotProps={{ input: { readOnly: mode === 'profile' } }}
            />
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              size="small"
              fullWidth
              autoFocus={mode === 'profile'}
            />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleConnect}>Connect</Button>
      </DialogActions>
    </Dialog>
  );
}
