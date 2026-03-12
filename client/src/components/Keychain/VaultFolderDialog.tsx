import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  FormControl, InputLabel, Select, MenuItem, Box, Alert,
} from '@mui/material';
import { createVaultFolder, updateVaultFolder } from '../../api/vault-folders.api';
import type { VaultFolderData } from '../../api/vault-folders.api';
import { useSecretStore } from '../../store/secretStore';
import { useAuthStore } from '../../store/authStore';
import { useTeamStore } from '../../store/teamStore';
import { extractApiError } from '../../utils/apiError';
import { isAdminOrAbove } from '../../utils/roles';

interface VaultFolderDialogProps {
  open: boolean;
  onClose: () => void;
  folder?: VaultFolderData | null;
  parentId?: string | null;
  scope?: 'PERSONAL' | 'TEAM' | 'TENANT';
  teamId?: string | null;
}

function getDescendantIds(folderId: string, folders: VaultFolderData[]): Set<string> {
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

export default function VaultFolderDialog({
  open, onClose, folder, parentId, scope: propScope = 'PERSONAL', teamId: propTeamId,
}: VaultFolderDialogProps) {
  const [name, setName] = useState('');
  const [selectedParentId, setSelectedParentId] = useState('');
  const [selectedScope, setSelectedScope] = useState<'PERSONAL' | 'TEAM' | 'TENANT'>('PERSONAL');
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const vaultFolders = useSecretStore((s) => s.vaultFolders);
  const vaultTeamFolders = useSecretStore((s) => s.vaultTeamFolders);
  const vaultTenantFolders = useSecretStore((s) => s.vaultTenantFolders);
  const tenantVaultStatus = useSecretStore((s) => s.tenantVaultStatus);
  const fetchVaultFolders = useSecretStore((s) => s.fetchVaultFolders);
  const fetchSecrets = useSecretStore((s) => s.fetchSecrets);

  const user = useAuthStore((s) => s.user);
  const teams = useTeamStore((s) => s.teams);
  const fetchTeams = useTeamStore((s) => s.fetchTeams);

  const isEditMode = Boolean(folder);

  const canSelectTeam = user?.tenantId && teams.length > 0;
  const canSelectTenant = user?.tenantId && isAdminOrAbove(user.tenantRole);
  const tenantVaultReady = tenantVaultStatus?.initialized && tenantVaultStatus?.hasAccess;

  // Determine active scope and teamId
  const activeScope = isEditMode ? (folder?.scope ?? 'PERSONAL') : selectedScope;
  const activeTeamId = isEditMode ? (folder?.teamId ?? null) : (selectedTeamId || null);

  // Get folders for the current scope
  const scopeFolders = activeScope === 'TEAM'
    ? vaultTeamFolders.filter((f) => f.teamId === activeTeamId)
    : activeScope === 'TENANT'
      ? vaultTenantFolders
      : vaultFolders;

  useEffect(() => {
    if (open) {
      fetchTeams();
      if (folder) {
        setName(folder.name);
        setSelectedParentId(folder.parentId || '');
        setSelectedScope(folder.scope);
        setSelectedTeamId(folder.teamId || '');
      } else {
        setName('');
        setSelectedParentId(parentId || '');
        setSelectedScope(propScope);
        setSelectedTeamId(propTeamId || '');
      }
      setError('');
    }
  }, [open, folder, parentId, propScope, propTeamId, fetchTeams]);

  // Reset parent when scope/team changes (parent folders are scope-specific)
  useEffect(() => {
    if (!isEditMode) {
      setSelectedParentId('');
    }
  }, [selectedScope, selectedTeamId, isEditMode]);

  const excludedIds = folder
    ? new Set([folder.id, ...getDescendantIds(folder.id, scopeFolders)])
    : new Set<string>();

  const availableParents = scopeFolders.filter((f) => !excludedIds.has(f.id));

  const handleSubmit = async () => {
    setError('');
    if (!name.trim()) {
      setError('Folder name is required');
      return;
    }
    if (!isEditMode && activeScope === 'TEAM' && !activeTeamId) {
      setError('Please select a team');
      return;
    }

    setLoading(true);
    try {
      if (isEditMode && folder) {
        const data: { name?: string; parentId?: string | null } = {};
        if (name !== folder.name) data.name = name.trim();
        if (selectedParentId !== (folder.parentId || '')) {
          data.parentId = selectedParentId || null;
        }
        if (Object.keys(data).length > 0) {
          await updateVaultFolder(folder.id, data);
        }
      } else {
        await createVaultFolder({
          name: name.trim(),
          scope: activeScope,
          ...(selectedParentId ? { parentId: selectedParentId } : {}),
          ...(activeScope === 'TEAM' && activeTeamId ? { teamId: activeTeamId } : {}),
        });
      }
      await fetchVaultFolders();
      await fetchSecrets();
      handleClose();
    } catch (err: unknown) {
      setError(extractApiError(err, isEditMode ? 'Failed to update folder' : 'Failed to create folder'));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setName('');
    setSelectedParentId('');
    setSelectedScope('PERSONAL');
    setSelectedTeamId('');
    setError('');
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

          {/* Scope selector — only on create */}
          {!isEditMode && (
            <FormControl fullWidth>
              <InputLabel>Scope</InputLabel>
              <Select
                value={selectedScope}
                label="Scope"
                onChange={(e) => setSelectedScope(e.target.value as 'PERSONAL' | 'TEAM' | 'TENANT')}
              >
                <MenuItem value="PERSONAL">Personal</MenuItem>
                {canSelectTeam && <MenuItem value="TEAM">Team</MenuItem>}
                {canSelectTenant && (
                  <MenuItem value="TENANT" disabled={!tenantVaultReady}>
                    Organization{!tenantVaultReady ? ' (vault not initialized)' : ''}
                  </MenuItem>
                )}
              </Select>
            </FormControl>
          )}

          {/* Team selector — only on create + TEAM scope */}
          {!isEditMode && selectedScope === 'TEAM' && (
            <FormControl fullWidth>
              <InputLabel>Team</InputLabel>
              <Select
                value={selectedTeamId}
                label="Team"
                onChange={(e) => setSelectedTeamId(e.target.value)}
              >
                {teams.map((t) => (
                  <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

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
