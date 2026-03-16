import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Box, Alert, List, ListItem, ListItemText, IconButton, Typography, Chip,
  FormControl, InputLabel, Select, MenuItem, Switch, FormControlLabel,
  InputAdornment, Tooltip, Divider,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  ContentCopy as CopyIcon,
  Link as LinkIcon,
} from '@mui/icons-material';
import {
  createExternalShare, listExternalShares, revokeExternalShare,
} from '../../api/secrets.api';
import { useNotificationStore } from '../../store/notificationStore';
import type { ExternalShareResult, ExternalShareListItem } from '../../api/secrets.api';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';

interface ExternalShareDialogProps {
  open: boolean;
  onClose: () => void;
  secretId: string;
  secretName: string;
}

const EXPIRY_OPTIONS = [
  { label: '1 hour', value: 60 },
  { label: '24 hours', value: 1440 },
  { label: '7 days', value: 10080 },
  { label: '30 days', value: 43200 },
];

export default function ExternalShareDialog({
  open,
  onClose,
  secretId,
  secretName,
}: ExternalShareDialogProps) {
  const [expiresInMinutes, setExpiresInMinutes] = useState(1440);
  const [maxAccessCount, setMaxAccessCount] = useState('');
  const [usePin, setUsePin] = useState(false);
  const [pin, setPin] = useState('');
  const { loading, error, setError, run } = useAsyncAction();
  const [result, setResult] = useState<ExternalShareResult | null>(null);
  const { copied, copy: copyToClipboard } = useCopyToClipboard();
  const [shares, setShares] = useState<ExternalShareListItem[]>([]);
  const notify = useNotificationStore((s) => s.notify);

  useEffect(() => {
    if (open && secretId) {
      loadShares();
      setResult(null);
      setError('');
      setPin('');
      setUsePin(false);
      setMaxAccessCount('');
      setExpiresInMinutes(1440);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, secretId]);

  const loadShares = async () => {
    try {
      const data = await listExternalShares(secretId);
      setShares(data);
    } catch {
      // silently fail
    }
  };

  const handleCreate = async () => {
    if (usePin && !/^\d{4,8}$/.test(pin)) {
      setError('PIN must be 4-8 digits');
      return;
    }
    const input: { expiresInMinutes: number; maxAccessCount?: number; pin?: string } = {
      expiresInMinutes,
    };
    if (maxAccessCount) {
      const count = parseInt(maxAccessCount, 10);
      if (isNaN(count) || count < 1) {
        setError('Max access count must be a positive number');
        return;
      }
      input.maxAccessCount = count;
    }
    if (usePin && pin) {
      input.pin = pin;
    }
    await run(async () => {
      const res = await createExternalShare(secretId, input);
      setResult(res);
      notify('Share link created successfully!', 'success');
      await loadShares();
    }, 'Failed to create external share');
  };

  const handleCopy = () => {
    if (result?.shareUrl) {
      copyToClipboard(result.shareUrl);
    }
  };

  const handleRevoke = async (shareId: string) => {
    try {
      await revokeExternalShare(shareId);
      await loadShares();
    } catch {
      // silently fail
    }
  };

  const formatExpiry = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = d.getTime() - now.getTime();
    if (diffMs <= 0) return 'Expired';
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    if (hours < 24) return `${hours}h left`;
    const days = Math.floor(hours / 24);
    return `${days}d left`;
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>External Share: {secretName}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {result ? (
          <Box sx={{ mt: 1 }}>
            <TextField
              fullWidth
              value={result.shareUrl}
              size="small"
              slotProps={{
                input: {
                  readOnly: true,
                  endAdornment: (
                    <InputAdornment position="end">
                      <Tooltip title={copied ? 'Copied!' : 'Copy link'}>
                        <IconButton size="small" onClick={handleCopy}>
                          <CopyIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </InputAdornment>
                  ),
                },
              }}
              sx={{ mb: 1 }}
            />
            {result.hasPin && (
              <Typography variant="caption" color="text.secondary">
                The recipient will need the PIN to access this secret.
              </Typography>
            )}
            <Button
              variant="outlined"
              fullWidth
              sx={{ mt: 2 }}
              onClick={() => setResult(null)}
            >
              Create Another Link
            </Button>
          </Box>
        ) : (
          <Box sx={{ mt: 1 }}>
            <FormControl fullWidth size="small" sx={{ mb: 2 }}>
              <InputLabel>Expires in</InputLabel>
              <Select
                value={expiresInMinutes}
                label="Expires in"
                onChange={(e) => setExpiresInMinutes(e.target.value as number)}
              >
                {EXPIRY_OPTIONS.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              label="Max access count (optional)"
              value={maxAccessCount}
              onChange={(e) => setMaxAccessCount(e.target.value)}
              size="small"
              fullWidth
              type="number"
              placeholder="Unlimited"
              sx={{ mb: 2 }}
            />

            <FormControlLabel
              control={
                <Switch
                  checked={usePin}
                  onChange={(e) => {
                    setUsePin(e.target.checked);
                    if (!e.target.checked) setPin('');
                  }}
                />
              }
              label="Require PIN"
              sx={{ mb: 1 }}
            />

            {usePin && (
              <TextField
                label="PIN (4-8 digits)"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                size="small"
                fullWidth
                placeholder="e.g. 1234"
                sx={{ mb: 2 }}
              />
            )}

            <Button
              variant="contained"
              fullWidth
              onClick={handleCreate}
              disabled={loading}
              startIcon={<LinkIcon />}
            >
              {loading ? 'Creating...' : 'Create Share Link'}
            </Button>
          </Box>
        )}

        {shares.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Existing Links
            </Typography>
            <List dense>
              {shares.map((share) => {
                const isActive = !share.isRevoked &&
                  new Date(share.expiresAt) > new Date() &&
                  (share.maxAccessCount === null || share.accessCount < share.maxAccessCount);
                return (
                  <ListItem key={share.id}>
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="body2">
                            {share.accessCount} access{share.accessCount !== 1 ? 'es' : ''}
                            {share.maxAccessCount !== null && ` / ${share.maxAccessCount}`}
                          </Typography>
                          {share.hasPin && <Chip label="PIN" size="small" variant="outlined" />}
                          <Chip
                            label={share.isRevoked ? 'Revoked' : isActive ? formatExpiry(share.expiresAt) : 'Expired'}
                            size="small"
                            color={share.isRevoked ? 'error' : isActive ? 'success' : 'default'}
                          />
                        </Box>
                      }
                      secondary={`Created ${new Date(share.createdAt).toLocaleDateString()}`}
                    />
                    {isActive && (
                      <Tooltip title="Revoke">
                        <IconButton
                          edge="end"
                          size="small"
                          onClick={() => handleRevoke(share.id)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </ListItem>
                );
              })}
            </List>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
