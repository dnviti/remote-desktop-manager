import { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Typography, Alert, MenuItem,
} from '@mui/material';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { requestCheckout } from '../../api/checkout.api';

interface RequestCheckoutDialogProps {
  open: boolean;
  onClose: () => void;
  /** Pre-filled target. Exactly one should be provided. */
  secretId?: string;
  connectionId?: string;
  resourceName: string;
}

const DURATION_OPTIONS = [
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 240, label: '4 hours' },
  { value: 480, label: '8 hours' },
  { value: 1440, label: '24 hours' },
];

export default function RequestCheckoutDialog({
  open,
  onClose,
  secretId,
  connectionId,
  resourceName,
}: RequestCheckoutDialogProps) {
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [reason, setReason] = useState('');
  const { loading, error, setError, run } = useAsyncAction();

  const handleSubmit = async () => {
    const success = await run(async () => {
      await requestCheckout({
        secretId,
        connectionId,
        durationMinutes,
        reason: reason.trim() || undefined,
      });
    }, 'Failed to submit checkout request');
    if (success) {
      setReason('');
      setDurationMinutes(60);
      onClose();
    }
  };

  const handleClose = () => {
    setError('');
    setReason('');
    setDurationMinutes(60);
    onClose();
  };

  const resourceType = secretId ? 'secret' : 'connection';

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Request Temporary Access</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Request temporary access to {resourceType} <strong>{resourceName}</strong>.
          The owner or an administrator will be notified to approve your request.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <TextField
          select
          label="Duration"
          value={durationMinutes}
          onChange={(e) => setDurationMinutes(Number(e.target.value))}
          fullWidth
          sx={{ mb: 2 }}
        >
          {DURATION_OPTIONS.map((opt) => (
            <MenuItem key={opt.value} value={opt.value}>
              {opt.label}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          label="Reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          fullWidth
          multiline
          rows={2}
          inputProps={{ maxLength: 500 }}
          helperText={`${reason.length}/500`}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button onClick={handleSubmit} variant="contained" disabled={loading}>
          {loading ? 'Submitting...' : 'Request Access'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
