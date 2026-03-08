import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  FormControl, InputLabel, Select, MenuItem, Box, Alert, List, ListItem,
  ListItemText, IconButton, Typography, Chip,
  ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import { Delete as DeleteIcon } from '@mui/icons-material';
import {
  shareSecret, unshareSecret, listShares,
} from '../../api/secrets.api';
import type { SecretShare } from '../../api/secrets.api';
import { useAuthStore } from '../../store/authStore';
import { UserSearchResult } from '../../api/user.api';
import UserPicker from '../UserPicker';

interface ShareSecretDialogProps {
  open: boolean;
  onClose: () => void;
  secretId: string;
  secretName: string;
  teamId?: string | null;
}

export default function ShareSecretDialog({
  open,
  onClose,
  secretId,
  secretName,
  teamId,
}: ShareSecretDialogProps) {
  const hasTenant = !!useAuthStore((s) => s.user?.tenantId);
  const [email, setEmail] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null);
  const [scope, setScope] = useState<'tenant' | 'team'>('tenant');
  const [permission, setPermission] = useState<'READ_ONLY' | 'FULL_ACCESS'>('READ_ONLY');
  const [shares, setShares] = useState<SecretShare[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && secretId) {
      loadShares();
      setSelectedUser(null);
      setEmail('');
      setError('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only trigger on dialog open
  }, [open, secretId]);

  const loadShares = async () => {
    try {
      const data = await listShares(secretId);
      setShares(data);
    } catch {
      // silently fail
    }
  };

  const sharedUserIds = shares.map((s) => s.userId);

  const handleShare = async () => {
    setError('');
    if (hasTenant) {
      if (!selectedUser) {
        setError('Select a user to share with');
        return;
      }
    } else {
      if (!email) {
        setError('Email is required');
        return;
      }
    }
    setLoading(true);
    try {
      const target = selectedUser
        ? { userId: selectedUser.id }
        : { email };
      await shareSecret(secretId, target, permission);
      setSelectedUser(null);
      setEmail('');
      await loadShares();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to share secret';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleUnshare = async (userId: string) => {
    try {
      await unshareSecret(secretId, userId);
      await loadShares();
    } catch {
      // silently fail
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Share: {secretName}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {hasTenant && teamId && (
          <ToggleButtonGroup
            value={scope}
            exclusive
            onChange={(_e, val) => { if (val) setScope(val); }}
            size="small"
            sx={{ mt: 1, mb: 1 }}
          >
            <ToggleButton value="tenant">Organization</ToggleButton>
            <ToggleButton value="team">My Team</ToggleButton>
          </ToggleButtonGroup>
        )}

        <Box sx={{ display: 'flex', gap: 1, mt: 1, mb: 2 }}>
          {hasTenant ? (
            <UserPicker
              onSelect={setSelectedUser}
              scope={scope}
              teamId={scope === 'team' && teamId ? teamId : undefined}
              placeholder="Search users by name or email..."
              excludeUserIds={sharedUserIds}
            />
          ) : (
            <TextField
              label="User email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              size="small"
              fullWidth
            />
          )}
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Permission</InputLabel>
            <Select
              value={permission}
              label="Permission"
              onChange={(e) =>
                setPermission(e.target.value as 'READ_ONLY' | 'FULL_ACCESS')
              }
            >
              <MenuItem value="READ_ONLY">Read Only</MenuItem>
              <MenuItem value="FULL_ACCESS">Full Access</MenuItem>
            </Select>
          </FormControl>
          <Button
            variant="contained"
            onClick={handleShare}
            disabled={loading}
            sx={{ whiteSpace: 'nowrap' }}
          >
            Share
          </Button>
        </Box>

        {shares.length > 0 ? (
          <List dense>
            {shares.map((share) => (
              <ListItem key={share.id}>
                <ListItemText
                  primary={share.email}
                  secondary={
                    <Chip
                      label={share.permission === 'READ_ONLY' ? 'Read Only' : 'Full Access'}
                      size="small"
                      color={share.permission === 'FULL_ACCESS' ? 'primary' : 'default'}
                    />
                  }
                />
                <IconButton
                  edge="end"
                  size="small"
                  onClick={() => handleUnshare(share.userId)}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </ListItem>
            ))}
          </List>
        ) : (
          <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 2 }}>
            Not shared with anyone yet
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
