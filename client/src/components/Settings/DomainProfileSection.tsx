import { useState, useEffect } from 'react';
import {
  Card, CardContent, Typography, TextField, Button, Alert, Stack,
  Chip, CircularProgress, Box, Dialog, DialogTitle, DialogContent,
  DialogActions, DialogContentText,
} from '@mui/material';
import DomainIcon from '@mui/icons-material/Domain';
import {
  getDomainProfile, updateDomainProfile, clearDomainProfile,
  type DomainProfile,
} from '../../api/user.api';
import { useVaultStore } from '../../store/vaultStore';
import { extractApiError } from '../../utils/apiError';
import { useNotificationStore } from '../../store/notificationStore';

export default function DomainProfileSection() {
  const [profile, setProfile] = useState<DomainProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const notify = useNotificationStore((s) => s.notify);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  const [domainName, setDomainName] = useState('');
  const [domainUsername, setDomainUsername] = useState('');
  const [domainPassword, setDomainPassword] = useState('');
  const [clearPassword, setClearPassword] = useState(false);

  const vaultUnlocked = useVaultStore((s) => s.unlocked);

  useEffect(() => {
    getDomainProfile()
      .then((data) => {
        setProfile(data);
        setDomainName(data.domainName ?? '');
        setDomainUsername(data.domainUsername ?? '');
      })
      .catch(() => setError('Failed to load domain profile'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setError('');
    setSaving(true);
    try {
      const data: Record<string, string | null | undefined> = {};
      if (domainName !== (profile?.domainName ?? '')) data.domainName = domainName;
      if (domainUsername !== (profile?.domainUsername ?? '')) data.domainUsername = domainUsername;
      if (domainPassword) data.domainPassword = domainPassword;
      else if (clearPassword) data.domainPassword = null;

      const result = await updateDomainProfile(data);
      setProfile(result);
      setDomainPassword('');
      setClearPassword(false);
      setEditing(false);
      notify('Domain profile updated', 'success');
    } catch (err: unknown) {
      setError(extractApiError(err, 'Failed to update domain profile'));
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setConfirmClearOpen(false);
    setError('');
    setSaving(true);
    try {
      await clearDomainProfile();
      const empty: DomainProfile = { domainName: null, domainUsername: null, hasDomainPassword: false };
      setProfile(empty);
      setDomainName('');
      setDomainUsername('');
      setDomainPassword('');
      setClearPassword(false);
      setEditing(false);
      notify('Domain profile cleared', 'success');
    } catch (err: unknown) {
      setError(extractApiError(err, 'Failed to clear domain profile'));
    } finally {
      setSaving(false);
    }
  };

  const startEditing = () => {
    setDomainName(profile?.domainName ?? '');
    setDomainUsername(profile?.domainUsername ?? '');
    setDomainPassword('');
    setClearPassword(false);
    setError('');
    setEditing(true);
  };

  if (loading) {
    return (
      <Card>
        <CardContent sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={24} />
        </CardContent>
      </Card>
    );
  }

  const hasProfile = profile?.domainName || profile?.domainUsername;

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <DomainIcon fontSize="small" color="action" />
          <Typography variant="h6">Domain Identity</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Configure your Windows/AD domain credentials for RDP and SSH connections.
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

        {!editing ? (
          <Box>
            {hasProfile ? (
              <Stack spacing={1} sx={{ mb: 2 }}>
                <Typography variant="body2">
                  <strong>Domain:</strong> {profile?.domainName ?? '—'}
                </Typography>
                <Typography variant="body2">
                  <strong>Username:</strong> {profile?.domainUsername ?? '—'}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2"><strong>Password:</strong></Typography>
                  <Chip
                    label={profile?.hasDomainPassword ? 'Stored' : 'Not set'}
                    color={profile?.hasDomainPassword ? 'success' : 'default'}
                    size="small"
                    variant="outlined"
                  />
                </Box>
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                No domain identity configured.
              </Typography>
            )}
            <Stack direction="row" spacing={1}>
              <Button variant="outlined" size="small" onClick={startEditing}>
                {hasProfile ? 'Edit' : 'Configure'}
              </Button>
              {hasProfile && (
                <Button
                  variant="outlined"
                  size="small"
                  color="error"
                  onClick={() => setConfirmClearOpen(true)}
                >
                  Clear
                </Button>
              )}
            </Stack>
          </Box>
        ) : (
          <Stack spacing={2}>
            <TextField
              label="Domain Name"
              placeholder="e.g. CONTOSO"
              value={domainName}
              onChange={(e) => setDomainName(e.target.value)}
              size="small"
              fullWidth
              helperText="NetBIOS or FQDN domain name (e.g. CONTOSO or contoso.com)"
            />
            <TextField
              label="Domain Username"
              placeholder="e.g. john.doe"
              value={domainUsername}
              onChange={(e) => setDomainUsername(e.target.value)}
              size="small"
              fullWidth
            />
            <TextField
              label={profile?.hasDomainPassword && !clearPassword ? 'New Password (leave blank to keep)' : 'Domain Password (optional)'}
              type="password"
              value={domainPassword}
              onChange={(e) => {
                setDomainPassword(e.target.value);
                if (e.target.value) setClearPassword(false);
              }}
              size="small"
              fullWidth
              disabled={!vaultUnlocked && !profile?.hasDomainPassword}
              helperText={
                !vaultUnlocked
                  ? 'Unlock your vault to set or change the domain password'
                  : 'Encrypted with your vault master key'
              }
            />
            {profile?.hasDomainPassword && !domainPassword && (
              <Button
                variant="text"
                size="small"
                color={clearPassword ? 'primary' : 'error'}
                onClick={() => setClearPassword(!clearPassword)}
                sx={{ alignSelf: 'flex-start' }}
              >
                {clearPassword ? 'Keep existing password' : 'Remove saved password'}
              </Button>
            )}
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                size="small"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? <CircularProgress size={20} /> : 'Save'}
              </Button>
              <Button
                variant="outlined"
                size="small"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                Cancel
              </Button>
            </Stack>
          </Stack>
        )}
      </CardContent>

      <Dialog open={confirmClearOpen} onClose={() => setConfirmClearOpen(false)}>
        <DialogTitle>Clear Domain Identity</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will remove your domain name, username, and saved password. Continue?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmClearOpen(false)}>Cancel</Button>
          <Button onClick={handleClear} color="error">Clear</Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
