import { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Box, Alert,
  FormControl, InputLabel, Select, MenuItem,
} from '@mui/material';
import { useTenantStore } from '../../store/tenantStore';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { ASSIGNABLE_ROLES, ROLE_LABELS, type TenantRole } from '../../utils/roles';

interface InviteDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function InviteDialog({ open, onClose }: InviteDialogProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TenantRole>('MEMBER');
  const { loading, error, setError, run } = useAsyncAction();
  const inviteUser = useTenantStore((s) => s.inviteUser);

  const handleSubmit = async () => {
    if (!email.trim()) {
      setError('Email is required');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Please enter a valid email address');
      return;
    }

    const ok = await run(async () => {
      await inviteUser(email.trim(), role);
    }, 'Failed to invite user');
    if (ok) handleClose();
  };

  const handleClose = () => {
    setEmail('');
    setRole('MEMBER');
    setError('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>Invite Member</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            label="Email Address"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            fullWidth
            required
            autoFocus
          />
          <FormControl fullWidth>
            <InputLabel>Role</InputLabel>
            <Select
              value={role}
              label="Role"
              onChange={(e) => setRole(e.target.value as TenantRole)}
            >
              {ASSIGNABLE_ROLES.map((r) => (
                <MenuItem key={r} value={r}>{ROLE_LABELS[r]}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button onClick={handleSubmit} variant="contained" disabled={loading}>
          {loading ? 'Inviting...' : 'Invite'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
