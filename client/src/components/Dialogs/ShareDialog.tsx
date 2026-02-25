import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  FormControl, InputLabel, Select, MenuItem, Box, Alert, List, ListItem,
  ListItemText, ListItemSecondaryAction, IconButton, Typography, Chip,
} from '@mui/material';
import { Delete as DeleteIcon } from '@mui/icons-material';
import {
  shareConnection, unshareConnection, listShares, ShareData,
} from '../../api/sharing.api';

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  connectionId: string;
  connectionName: string;
}

export default function ShareDialog({
  open,
  onClose,
  connectionId,
  connectionName,
}: ShareDialogProps) {
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState<'READ_ONLY' | 'FULL_ACCESS'>('READ_ONLY');
  const [shares, setShares] = useState<ShareData[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      loadShares();
    }
  }, [open, connectionId]);

  const loadShares = async () => {
    try {
      const data = await listShares(connectionId);
      setShares(data);
    } catch {}
  };

  const handleShare = async () => {
    setError('');
    if (!email) {
      setError('Email is required');
      return;
    }
    setLoading(true);
    try {
      await shareConnection(connectionId, email, permission);
      setEmail('');
      await loadShares();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to share connection';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleUnshare = async (userId: string) => {
    try {
      await unshareConnection(connectionId, userId);
      await loadShares();
    } catch {}
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Share: {connectionName}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Box sx={{ display: 'flex', gap: 1, mt: 1, mb: 2 }}>
          <TextField
            label="User email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            size="small"
            fullWidth
          />
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
                <ListItemSecondaryAction>
                  <IconButton
                    edge="end"
                    size="small"
                    onClick={() => handleUnshare(share.userId)}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </ListItemSecondaryAction>
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
