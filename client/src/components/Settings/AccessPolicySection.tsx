import { useState, useEffect, useMemo } from 'react';
import {
  Card, CardContent, Typography, Box, Button, Alert, CircularProgress,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Switch, FormControlLabel, MenuItem, Chip, Tooltip,
} from '@mui/material';
import {
  Add as AddIcon, Delete as DeleteIcon, Edit as EditIcon,
} from '@mui/icons-material';
import { useAuthStore } from '../../store/authStore';
import { useAccessPolicyStore } from '../../store/accessPolicyStore';
import { listTeams, type TeamData } from '../../api/team.api';
import { listFolders, type FolderData } from '../../api/folders.api';
import type { AccessPolicyData, AccessPolicyTargetType, CreateAccessPolicyInput } from '../../api/accessPolicy.api';
import { useAsyncAction } from '../../hooks/useAsyncAction';

// eslint-disable-next-line security/detect-unsafe-regex
const TIME_WINDOW_RE = /^(\d{2}:\d{2}-\d{2}:\d{2})(,\s*\d{2}:\d{2}-\d{2}:\d{2})*$/;

function validateTimeWindows(value: string): string | null {
  if (!value.trim()) return null;
  if (!TIME_WINDOW_RE.test(value.trim())) {
    return 'Format must be HH:MM-HH:MM (comma-separated for multiple)';
  }
  const windows = value.split(',').map((w) => w.trim());
  for (const w of windows) {
    const [startStr, endStr] = w.split('-');
    if (!startStr || !endStr) return 'Invalid time window format';
    const [sh, sm] = startStr.split(':').map(Number);
    const [eh, em] = endStr.split(':').map(Number);
    if (sh < 0 || sh > 23 || sm < 0 || sm > 59 || eh < 0 || eh > 23 || em < 0 || em > 59) {
      return 'Hours must be 0-23, minutes 0-59';
    }
  }
  return null;
}

const TARGET_TYPE_LABELS: Record<AccessPolicyTargetType, string> = {
  TENANT: 'Tenant',
  TEAM: 'Team',
  FOLDER: 'Folder',
};

interface FormState {
  targetType: AccessPolicyTargetType;
  targetId: string;
  allowedTimeWindows: string;
  requireTrustedDevice: boolean;
  requireMfaStepUp: boolean;
}

const emptyForm: FormState = {
  targetType: 'TENANT',
  targetId: '',
  allowedTimeWindows: '',
  requireTrustedDevice: false,
  requireMfaStepUp: false,
};

export default function AccessPolicySection() {
  const user = useAuthStore((s) => s.user);
  const tenantId = user?.tenantId;

  const policies = useAccessPolicyStore((s) => s.policies);
  const loading = useAccessPolicyStore((s) => s.loading);
  const fetchPolicies = useAccessPolicyStore((s) => s.fetchPolicies);
  const createPolicyAction = useAccessPolicyStore((s) => s.createPolicy);
  const updatePolicyAction = useAccessPolicyStore((s) => s.updatePolicy);
  const deletePolicyAction = useAccessPolicyStore((s) => s.deletePolicy);

  const [teams, setTeams] = useState<TeamData[]>([]);
  const [folders, setFolders] = useState<FolderData[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<AccessPolicyData | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<AccessPolicyData | null>(null);

  const saveAction = useAsyncAction();
  const deleteAction = useAsyncAction();

  useEffect(() => {
    if (tenantId) {
      fetchPolicies();
      listTeams().then(setTeams).catch(() => {});
      listFolders().then((res) => setFolders([...res.personal, ...res.team])).catch(() => {});
    }
  }, [fetchPolicies, tenantId]);

  // Build name lookup maps
  const nameMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (tenantId) map[tenantId] = 'Current Tenant';
    teams.forEach((t) => { map[t.id] = t.name; });
    folders.forEach((f) => { map[f.id] = f.name; });
    return map;
  }, [tenantId, teams, folders]);

  const handleOpenCreate = () => {
    setEditingPolicy(null);
    setForm({ ...emptyForm, targetId: tenantId ?? '' });
    setFormError('');
    setDialogOpen(true);
  };

  const handleOpenEdit = (policy: AccessPolicyData) => {
    setEditingPolicy(policy);
    setForm({
      targetType: policy.targetType,
      targetId: policy.targetId,
      allowedTimeWindows: policy.allowedTimeWindows ?? '',
      requireTrustedDevice: policy.requireTrustedDevice,
      requireMfaStepUp: policy.requireMfaStepUp,
    });
    setFormError('');
    setDialogOpen(true);
  };

  const handleClose = () => {
    setDialogOpen(false);
    setEditingPolicy(null);
  };

  const handleSave = async () => {
    // Validate time windows
    if (form.allowedTimeWindows.trim()) {
      const twError = validateTimeWindows(form.allowedTimeWindows);
      if (twError) {
        setFormError(twError);
        return;
      }
    }

    if (!editingPolicy && !form.targetId) {
      setFormError('Please select a target');
      return;
    }

    const ok = await saveAction.run(async () => {
      if (editingPolicy) {
        await updatePolicyAction(editingPolicy.id, {
          allowedTimeWindows: form.allowedTimeWindows.trim() || null,
          requireTrustedDevice: form.requireTrustedDevice,
          requireMfaStepUp: form.requireMfaStepUp,
        });
      } else {
        const payload: CreateAccessPolicyInput = {
          targetType: form.targetType,
          targetId: form.targetId,
          allowedTimeWindows: form.allowedTimeWindows.trim() || null,
          requireTrustedDevice: form.requireTrustedDevice,
          requireMfaStepUp: form.requireMfaStepUp,
        };
        await createPolicyAction(payload);
      }
    }, 'Failed to save policy');

    if (ok) handleClose();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const ok = await deleteAction.run(async () => {
      await deletePolicyAction(deleteTarget.id);
    }, 'Failed to delete policy');
    if (ok) setDeleteTarget(null);
  };

  // Available target options based on selected type
  const targetOptions = useMemo(() => {
    switch (form.targetType) {
      case 'TENANT':
        return tenantId ? [{ id: tenantId, name: 'Current Tenant' }] : [];
      case 'TEAM':
        return teams.map((t) => ({ id: t.id, name: t.name }));
      case 'FOLDER':
        return folders.map((f) => ({ id: f.id, name: f.name }));
      default:
        return [];
    }
  }, [form.targetType, tenantId, teams, folders]);

  if (loading) {
    return (
      <Card variant="outlined">
        <CardContent sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={24} />
        </CardContent>
      </Card>
    );
  }

  if (!tenantId) return null;

  return (
    <>
      <Card variant="outlined">
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="subtitle1" fontWeight="bold">
              Access Policies (ABAC)
            </Typography>
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={handleOpenCreate}
            >
              Add Policy
            </Button>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Attribute-based access control policies restrict when and how users can open sessions.
            Policies are additive -- all applicable policies must pass (most restrictive wins).
          </Typography>

          {policies.length === 0 ? (
            <Alert severity="info">
              No access policies defined. All sessions are allowed by default.
            </Alert>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Target Type</TableCell>
                    <TableCell>Target</TableCell>
                    <TableCell>Time Windows (UTC)</TableCell>
                    <TableCell>Trusted Device</TableCell>
                    <TableCell>MFA Step-Up</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {policies.map((policy) => (
                    <TableRow key={policy.id}>
                      <TableCell>
                        <Chip label={TARGET_TYPE_LABELS[policy.targetType]} size="small" variant="outlined" />
                      </TableCell>
                      <TableCell>
                        {nameMap[policy.targetId] ?? policy.targetId}
                      </TableCell>
                      <TableCell>
                        {policy.allowedTimeWindows ? (
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {policy.allowedTimeWindows.split(',').map((w, i) => (
                              <Chip key={i} label={w.trim()} size="small" variant="outlined" />
                            ))}
                          </Box>
                        ) : (
                          <Typography variant="body2" color="text.secondary">Any time</Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={policy.requireTrustedDevice ? 'Required' : 'No'}
                          size="small"
                          color={policy.requireTrustedDevice ? 'warning' : 'default'}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={policy.requireMfaStepUp ? 'Required' : 'No'}
                          size="small"
                          color={policy.requireMfaStepUp ? 'warning' : 'default'}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Tooltip title="Edit">
                          <IconButton size="small" onClick={() => handleOpenEdit(policy)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton size="small" onClick={() => setDeleteTarget(policy)} color="error">
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>{editingPolicy ? 'Edit Policy' : 'Create Access Policy'}</DialogTitle>
        <DialogContent>
          {saveAction.error && <Alert severity="error" sx={{ mb: 2 }}>{saveAction.error}</Alert>}
          {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}

          {!editingPolicy && (
            <>
              <TextField
                select
                fullWidth
                label="Target Type"
                value={form.targetType}
                onChange={(e) => {
                  const tt = e.target.value as AccessPolicyTargetType;
                  setForm((f) => ({
                    ...f,
                    targetType: tt,
                    targetId: tt === 'TENANT' ? (tenantId ?? '') : '',
                  }));
                  setFormError('');
                }}
                margin="normal"
                size="small"
              >
                <MenuItem value="TENANT">Tenant</MenuItem>
                <MenuItem value="TEAM">Team</MenuItem>
                <MenuItem value="FOLDER">Folder</MenuItem>
              </TextField>

              <TextField
                select
                fullWidth
                label="Target"
                value={form.targetId}
                onChange={(e) => {
                  setForm((f) => ({ ...f, targetId: e.target.value }));
                  setFormError('');
                }}
                margin="normal"
                size="small"
                disabled={form.targetType === 'TENANT'}
              >
                {targetOptions.map((opt) => (
                  <MenuItem key={opt.id} value={opt.id}>{opt.name}</MenuItem>
                ))}
              </TextField>
            </>
          )}

          <TextField
            fullWidth
            label="Allowed Time Windows (UTC)"
            placeholder="e.g. 09:00-18:00 or 09:00-12:00,13:00-17:00"
            value={form.allowedTimeWindows}
            onChange={(e) => { setForm((f) => ({ ...f, allowedTimeWindows: e.target.value })); setFormError(''); }}
            margin="normal"
            size="small"
            helperText="Comma-separated HH:MM-HH:MM windows. Leave empty to allow any time."
          />

          <FormControlLabel
            control={
              <Switch
                checked={form.requireTrustedDevice}
                onChange={(e) => setForm((f) => ({ ...f, requireTrustedDevice: e.target.checked }))}
              />
            }
            label="Require trusted device (WebAuthn)"
            sx={{ mt: 1, display: 'block' }}
          />

          <FormControlLabel
            control={
              <Switch
                checked={form.requireMfaStepUp}
                onChange={(e) => setForm((f) => ({ ...f, requireMfaStepUp: e.target.checked }))}
              />
            }
            label="Require MFA step-up"
            sx={{ display: 'block' }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} disabled={saveAction.loading}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saveAction.loading}>
            {saveAction.loading ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Access Policy</DialogTitle>
        <DialogContent>
          {deleteAction.error && <Alert severity="error" sx={{ mb: 2 }}>{deleteAction.error}</Alert>}
          <Typography>
            Are you sure you want to delete this {TARGET_TYPE_LABELS[deleteTarget?.targetType ?? 'TENANT']}-level policy
            for &quot;{nameMap[deleteTarget?.targetId ?? ''] ?? deleteTarget?.targetId}&quot;?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleteAction.loading}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleDelete} disabled={deleteAction.loading}>
            {deleteAction.loading ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
