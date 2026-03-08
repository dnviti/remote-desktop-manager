import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Box, Alert,
} from '@mui/material';
import { useTeamStore } from '../../store/teamStore';
import { useConnectionsStore } from '../../store/connectionsStore';
import type { TeamData } from '../../api/team.api';

interface TeamDialogProps {
  open: boolean;
  onClose: () => void;
  team?: TeamData | null;
}

export default function TeamDialog({ open, onClose, team }: TeamDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const createTeam = useTeamStore((s) => s.createTeam);
  const updateTeam = useTeamStore((s) => s.updateTeam);
  const fetchConnections = useConnectionsStore((s) => s.fetchConnections);

  const isEditMode = Boolean(team);

  useEffect(() => {
    if (open && team) {
      setName(team.name);
      setDescription(team.description || '');
    } else if (open) {
      setName('');
      setDescription('');
    }
    setError('');
  }, [open, team]);

  const handleSubmit = async () => {
    setError('');
    if (!name.trim()) {
      setError('Team name is required');
      return;
    }
    if (name.trim().length < 2 || name.trim().length > 100) {
      setError('Team name must be between 2 and 100 characters');
      return;
    }

    setLoading(true);
    try {
      if (isEditMode && team) {
        const data: { name?: string; description?: string | null } = {};
        if (name.trim() !== team.name) data.name = name.trim();
        if (description.trim() !== (team.description || '')) {
          data.description = description.trim() || null;
        }
        if (Object.keys(data).length > 0) {
          await updateTeam(team.id, data);
        }
      } else {
        await createTeam(name.trim(), description.trim() || undefined);
        await fetchConnections();
      }
      handleClose();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (isEditMode ? 'Failed to update team' : 'Failed to create team');
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setName('');
    setDescription('');
    setError('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>{isEditMode ? 'Edit Team' : 'New Team'}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            label="Team Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
            autoFocus
            inputProps={{ maxLength: 100 }}
          />
          <TextField
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            multiline
            rows={3}
            inputProps={{ maxLength: 500 }}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button onClick={handleSubmit} variant="contained" disabled={loading}>
          {loading
            ? (isEditMode ? 'Saving...' : 'Creating...')
            : (isEditMode ? 'Save' : 'Create')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
