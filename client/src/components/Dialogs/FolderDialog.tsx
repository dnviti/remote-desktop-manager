import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  FormControl, InputLabel, Select, MenuItem, Box, Alert,
} from '@mui/material';
import { createFolder, updateFolder, FolderData } from '../../api/folders.api';
import { useConnectionsStore } from '../../store/connectionsStore';
import { useAsyncAction } from '../../hooks/useAsyncAction';

interface FolderDialogProps {
  open: boolean;
  onClose: () => void;
  folder?: FolderData | null;
  parentId?: string | null;
  teamId?: string | null;
}

function getDescendantIds(folderId: string, folders: FolderData[]): Set<string> {
  const ids = new Set<string>();
  const queue = [folderId];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    for (const f of folders) {
      if (f.parentId === current && !ids.has(f.id)) {
        ids.add(f.id);
        queue.push(f.id);
      }
    }
  }
  return ids;
}

export default function FolderDialog({ open, onClose, folder, parentId, teamId }: FolderDialogProps) {
  const [name, setName] = useState('');
  const [selectedParentId, setSelectedParentId] = useState('');
  const { loading, error, setError, clearError, run } = useAsyncAction();
  const folders = useConnectionsStore((s) => s.folders);
  const fetchConnections = useConnectionsStore((s) => s.fetchConnections);

  const isEditMode = Boolean(folder);

  useEffect(() => {
    if (open && folder) {
      setName(folder.name);
      setSelectedParentId(folder.parentId || '');
    } else if (open) {
      setName('');
      setSelectedParentId(parentId || '');
    }
    clearError();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- clearError is stable (useCallback with [])
  }, [open, folder, parentId]);

  const excludedIds = folder
    ? new Set([folder.id, ...getDescendantIds(folder.id, folders)])
    : new Set<string>();

  const availableParents = folders.filter((f) => !excludedIds.has(f.id));

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('Folder name is required');
      return;
    }

    const ok = await run(async () => {
      if (isEditMode && folder) {
        const data: { name?: string; parentId?: string | null } = {};
        if (name !== folder.name) data.name = name.trim();
        if (selectedParentId !== (folder.parentId || '')) {
          data.parentId = selectedParentId || null;
        }
        if (Object.keys(data).length > 0) {
          await updateFolder(folder.id, data);
        }
      } else {
        await createFolder({
          name: name.trim(),
          ...(selectedParentId ? { parentId: selectedParentId } : {}),
          ...(teamId ? { teamId } : {}),
        });
      }
      await fetchConnections();
    }, isEditMode ? 'Failed to update folder' : 'Failed to create folder');
    if (ok) handleClose();
  };

  const handleClose = () => {
    setName('');
    setSelectedParentId('');
    clearError();
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>{isEditMode ? 'Rename Folder' : 'New Folder'}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            label="Folder Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
            autoFocus
          />
          <FormControl fullWidth>
            <InputLabel>Parent Folder</InputLabel>
            <Select
              value={selectedParentId}
              label="Parent Folder"
              onChange={(e) => setSelectedParentId(e.target.value)}
            >
              <MenuItem value="">None (root level)</MenuItem>
              {availableParents.map((f) => (
                <MenuItem key={f.id} value={f.id}>{f.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
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
