import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  RadioGroup, Radio, FormControlLabel, Alert, Box, Typography, Chip,
} from '@mui/material';
import { VpnKey, Key, Domain } from '@mui/icons-material';
import { useAuthStore } from '../../store/authStore';
import { useTabsStore } from '../../store/tabsStore';
import { ConnectionData } from '../../api/connections.api';

type ConnectMode = 'saved' | 'profile' | 'manual' | 'domain';

interface ConnectAsDialogProps {
  open: boolean;
  onClose: () => void;
  connection: ConnectionData | null;
}

export default function ConnectAsDialog({ open, onClose, connection }: ConnectAsDialogProps) {
  const openTab = useTabsStore((s) => s.openTab);
  const user = useAuthStore((s) => s.user);
  const domainConfigured = Boolean(user?.domainUsername && user?.hasDomainPassword);

  const [mode, setMode] = useState<ConnectMode>('saved');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [domain, setDomain] = useState('');
  const [error, setError] = useState('');

  /* eslint-disable react-hooks/set-state-in-effect -- reset form state when dialog opens */
  useEffect(() => {
    if (open) {
      setMode('saved');
      setUsername('');
      setPassword('');
      setDomain('');
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
      setDomain('');
    }
    setError('');
  }, [mode, user]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleConnect = () => {
    if (!connection) return;

    if (mode === 'saved') {
      openTab(connection);
    } else if (mode === 'domain') {
      openTab(connection, { username: '', password: '', credentialMode: 'domain' });
    } else {
      if (!username.trim()) {
        setError('Username is required');
        return;
      }
      if (!password) {
        setError('Password is required');
        return;
      }
      openTab(connection, { username: username.trim(), password, ...(domain.trim() ? { domain: domain.trim() } : {}) });
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
          onChange={(e) => setMode(e.target.value as ConnectMode)}
        >
          <FormControlLabel
            value="saved"
            control={<Radio />}
            label={
              connection?.credentialSecretId ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography variant="body2">Use saved credentials</Typography>
                  <Chip
                    icon={connection.credentialSecretType === 'SSH_KEY'
                      ? <Key fontSize="small" />
                      : <VpnKey fontSize="small" />}
                    label={connection.credentialSecretName ?? 'Keychain secret'}
                    size="small"
                    variant="outlined"
                  />
                </Box>
              ) : (
                'Use saved credentials'
              )
            }
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
          <FormControlLabel
            value="domain"
            control={<Radio />}
            disabled={!domainConfigured}
            label={
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography variant="body2">Use domain credentials</Typography>
                  {domainConfigured && (
                    <Chip
                      icon={<Domain fontSize="small" />}
                      label={user?.domainName ? `${user.domainName}\\${user.domainUsername}` : user?.domainUsername}
                      size="small"
                      variant="outlined"
                    />
                  )}
                </Box>
                {!domainConfigured && (
                  <Typography variant="caption" color="text.secondary">
                    Not configured — set up in Settings &gt; Domain Profile
                  </Typography>
                )}
              </Box>
            }
          />
        </RadioGroup>

        {(mode === 'profile' || mode === 'manual') && (
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
            {connection?.type === 'RDP' && (
              <TextField
                label="Domain (optional)"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                size="small"
                fullWidth
                placeholder="e.g. CONTOSO"
              />
            )}
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
