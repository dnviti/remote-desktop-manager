import { useState, useEffect, useCallback } from 'react';
import {
  Card, CardContent, Typography, Box, Button, Stack,
  Table, TableHead, TableBody, TableRow, TableCell,
  Chip, IconButton, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, FormControl, InputLabel,
  Select, MenuItem, Switch, FormControlLabel, Alert,
  CircularProgress, Tooltip,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Speed as SpeedIcon,
} from '@mui/icons-material';
import {
  getRateLimitPolicies, createRateLimitPolicy, updateRateLimitPolicy, deleteRateLimitPolicy,
  RateLimitPolicy, RateLimitPolicyInput, RateLimitAction, DbQueryType,
} from '../../api/dbAudit.api';
import { useAsyncAction } from '../../hooks/useAsyncAction';

const ACTION_COLORS: Record<RateLimitAction, 'error' | 'warning'> = {
  REJECT: 'error',
  LOG_ONLY: 'warning',
};

const QUERY_TYPE_OPTIONS: Array<{ value: DbQueryType | ''; label: string }> = [
  { value: '', label: 'All Types' },
  { value: 'SELECT', label: 'SELECT' },
  { value: 'INSERT', label: 'INSERT' },
  { value: 'UPDATE', label: 'UPDATE' },
  { value: 'DELETE', label: 'DELETE' },
  { value: 'DDL', label: 'DDL' },
  { value: 'OTHER', label: 'OTHER' },
];

const WINDOW_OPTIONS = [
  { value: 10000, label: '10 seconds' },
  { value: 30000, label: '30 seconds' },
  { value: 60000, label: '1 minute' },
  { value: 300000, label: '5 minutes' },
  { value: 3600000, label: '1 hour' },
];

const EXEMPT_ROLE_OPTIONS = ['OWNER', 'ADMIN', 'OPERATOR', 'MEMBER', 'CONSULTANT', 'AUDITOR', 'GUEST'];

function formatWindow(ms: number): string {
  if (ms < 60000) return `${ms / 1000}s`;
  if (ms < 3600000) return `${ms / 60000}m`;
  return `${ms / 3600000}h`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DbRateLimitSection() {
  const [policies, setPolicies] = useState<RateLimitPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<RateLimitPolicy | null>(null);
  const [formData, setFormData] = useState<RateLimitPolicyInput>({
    name: '',
    queryType: null,
    windowMs: 60000,
    maxQueries: 100,
    burstMax: 10,
    exemptRoles: [],
    scope: '',
    action: 'REJECT',
    enabled: true,
    priority: 0,
  });
  const { loading: saving, error, run, clearError } = useAsyncAction();

  const fetchPolicies = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getRateLimitPolicies();
      setPolicies(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

  const handleOpenCreate = () => {
    setEditingPolicy(null);
    setFormData({
      name: '',
      queryType: null,
      windowMs: 60000,
      maxQueries: 100,
      burstMax: 10,
      exemptRoles: [],
      scope: '',
      action: 'REJECT',
      enabled: true,
      priority: 0,
    });
    clearError();
    setEditOpen(true);
  };

  const handleOpenEdit = (policy: RateLimitPolicy) => {
    setEditingPolicy(policy);
    setFormData({
      name: policy.name,
      queryType: policy.queryType,
      windowMs: policy.windowMs,
      maxQueries: policy.maxQueries,
      burstMax: policy.burstMax,
      exemptRoles: policy.exemptRoles,
      scope: policy.scope || '',
      action: policy.action,
      enabled: policy.enabled,
      priority: policy.priority,
    });
    clearError();
    setEditOpen(true);
  };

  const handleSave = async () => {
    const payload: RateLimitPolicyInput = {
      ...formData,
      queryType: formData.queryType || null,
      scope: formData.scope || undefined,
    };

    const ok = await run(async () => {
      if (editingPolicy) {
        await updateRateLimitPolicy(editingPolicy.id, payload);
      } else {
        await createRateLimitPolicy(payload);
      }
    }, 'Failed to save rate limit policy');

    if (ok) {
      setEditOpen(false);
      fetchPolicies();
    }
  };

  const handleDelete = async (policyId: string) => {
    await run(async () => {
      await deleteRateLimitPolicy(policyId);
      fetchPolicies();
    }, 'Failed to delete rate limit policy');
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <SpeedIcon color="primary" />
            <Typography variant="subtitle1" fontWeight="bold">Query Rate Limiting</Typography>
          </Box>
          <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={handleOpenCreate}>
            Add Policy
          </Button>
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Configure rate limits for SQL queries executed through database proxy sessions.
          Policies use a token bucket algorithm to enforce per-user query rate limits by query type.
        </Typography>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        ) : policies.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
            No rate limit policies configured. All queries are allowed without rate restrictions.
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Query Type</TableCell>
                <TableCell>Window</TableCell>
                <TableCell>Max Queries</TableCell>
                <TableCell>Burst</TableCell>
                <TableCell>Action</TableCell>
                <TableCell>Priority</TableCell>
                <TableCell>Enabled</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {policies.map((policy) => (
                <TableRow key={policy.id}>
                  <TableCell>
                    <Tooltip title={policy.scope ? `Scope: ${policy.scope}` : 'Global scope'}>
                      <span>{policy.name}</span>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={policy.queryType || 'All'}
                      size="small"
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>{formatWindow(policy.windowMs)}</TableCell>
                  <TableCell>{policy.maxQueries}</TableCell>
                  <TableCell>{policy.burstMax}</TableCell>
                  <TableCell>
                    <Chip label={policy.action === 'REJECT' ? 'Reject' : 'Log Only'} color={ACTION_COLORS[policy.action]} size="small" />
                  </TableCell>
                  <TableCell>{policy.priority}</TableCell>
                  <TableCell>
                    <Chip label={policy.enabled ? 'On' : 'Off'} size="small" color={policy.enabled ? 'success' : 'default'} variant="outlined" />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => handleOpenEdit(policy)}><EditIcon fontSize="small" /></IconButton>
                    <IconButton size="small" color="error" onClick={() => handleDelete(policy.id)}><DeleteIcon fontSize="small" /></IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingPolicy ? 'Edit Rate Limit Policy' : 'Create Rate Limit Policy'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}

            <TextField
              label="Name"
              size="small"
              fullWidth
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
            <FormControl size="small" fullWidth>
              <InputLabel>Query Type</InputLabel>
              <Select
                value={formData.queryType || ''}
                label="Query Type"
                onChange={(e) => setFormData({ ...formData, queryType: (e.target.value as DbQueryType) || null })}
              >
                {QUERY_TYPE_OPTIONS.map((opt) => (
                  <MenuItem key={opt.value || 'all'} value={opt.value}>{opt.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth>
              <InputLabel>Time Window</InputLabel>
              <Select
                value={formData.windowMs ?? 60000}
                label="Time Window"
                onChange={(e) => setFormData({ ...formData, windowMs: Number(e.target.value) })}
              >
                {WINDOW_OPTIONS.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="Max Queries"
              size="small"
              type="number"
              fullWidth
              value={formData.maxQueries ?? 100}
              onChange={(e) => setFormData({ ...formData, maxQueries: parseInt(e.target.value, 10) || 1 })}
              helperText="Maximum number of queries allowed within the time window"
            />
            <TextField
              label="Burst Max"
              size="small"
              type="number"
              fullWidth
              value={formData.burstMax ?? 10}
              onChange={(e) => setFormData({ ...formData, burstMax: parseInt(e.target.value, 10) || 1 })}
              helperText="Token bucket capacity — allows short bursts above the steady rate"
            />
            <FormControl size="small" fullWidth>
              <InputLabel>Exempt Roles</InputLabel>
              <Select
                multiple
                value={formData.exemptRoles ?? []}
                label="Exempt Roles"
                onChange={(e) => setFormData({ ...formData, exemptRoles: e.target.value as string[] })}
                renderValue={(selected) => (selected as string[]).join(', ') || 'None'}
              >
                {EXEMPT_ROLE_OPTIONS.map((role) => (
                  <MenuItem key={role} value={role}>{role}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="Scope (optional)"
              size="small"
              fullWidth
              value={formData.scope || ''}
              onChange={(e) => setFormData({ ...formData, scope: e.target.value })}
              helperText="Limit to a specific database or table name (leave empty for global)"
            />
            <FormControl size="small" fullWidth>
              <InputLabel>Action</InputLabel>
              <Select
                value={formData.action ?? 'REJECT'}
                label="Action"
                onChange={(e) => setFormData({ ...formData, action: e.target.value as RateLimitAction })}
              >
                <MenuItem value="REJECT">Reject - Block query execution</MenuItem>
                <MenuItem value="LOG_ONLY">Log Only - Allow but log over-limit</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="Priority"
              size="small"
              type="number"
              value={formData.priority ?? 0}
              onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value, 10) || 0 })}
              helperText="Higher priority policies are evaluated first"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={formData.enabled ?? true}
                  onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                />
              }
              label="Enabled"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={saving || !formData.name}
          >
            {saving ? <CircularProgress size={20} /> : editingPolicy ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
