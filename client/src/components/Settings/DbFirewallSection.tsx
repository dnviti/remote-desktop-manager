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
  Shield as ShieldIcon,
} from '@mui/icons-material';
import {
  getFirewallRules, createFirewallRule, updateFirewallRule, deleteFirewallRule,
  FirewallRule, FirewallRuleInput, FirewallAction,
} from '../../api/dbAudit.api';
import { useAsyncAction } from '../../hooks/useAsyncAction';

const ACTION_COLORS: Record<FirewallAction, 'error' | 'warning' | 'info'> = {
  BLOCK: 'error',
  ALERT: 'warning',
  LOG: 'info',
};

export default function DbFirewallSection() {
  const [rules, setRules] = useState<FirewallRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<FirewallRule | null>(null);
  const [formData, setFormData] = useState<FirewallRuleInput>({
    name: '',
    pattern: '',
    action: 'BLOCK',
    scope: '',
    description: '',
    enabled: true,
    priority: 0,
  });
  const { loading: saving, error, run, clearError } = useAsyncAction();

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getFirewallRules();
      setRules(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const handleOpenCreate = () => {
    setEditingRule(null);
    setFormData({ name: '', pattern: '', action: 'BLOCK', scope: '', description: '', enabled: true, priority: 0 });
    clearError();
    setEditOpen(true);
  };

  const handleOpenEdit = (rule: FirewallRule) => {
    setEditingRule(rule);
    setFormData({
      name: rule.name,
      pattern: rule.pattern,
      action: rule.action,
      scope: rule.scope || '',
      description: rule.description || '',
      enabled: rule.enabled,
      priority: rule.priority,
    });
    clearError();
    setEditOpen(true);
  };

  const handleSave = async () => {
    const ok = await run(async () => {
      if (editingRule) {
        await updateFirewallRule(editingRule.id, formData);
      } else {
        await createFirewallRule(formData);
      }
    }, 'Failed to save firewall rule');

    if (ok) {
      setEditOpen(false);
      fetchRules();
    }
  };

  const handleDelete = async (ruleId: string) => {
    await run(async () => {
      await deleteFirewallRule(ruleId);
      fetchRules();
    }, 'Failed to delete firewall rule');
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ShieldIcon color="primary" />
            <Typography variant="subtitle1" fontWeight="bold">SQL Firewall Rules</Typography>
          </Box>
          <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={handleOpenCreate}>
            Add Rule
          </Button>
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Define patterns to block, alert, or log dangerous SQL queries executed through database proxy sessions.
          Built-in rules automatically block DROP TABLE, TRUNCATE, and DROP DATABASE statements.
        </Typography>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        ) : rules.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
            No custom firewall rules configured. Built-in protections are always active.
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Pattern</TableCell>
                <TableCell>Action</TableCell>
                <TableCell>Scope</TableCell>
                <TableCell>Priority</TableCell>
                <TableCell>Enabled</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rules.map((rule) => (
                <TableRow key={rule.id}>
                  <TableCell>{rule.name}</TableCell>
                  <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                    <Tooltip title={rule.pattern}><span>{rule.pattern}</span></Tooltip>
                  </TableCell>
                  <TableCell>
                    <Chip label={rule.action} color={ACTION_COLORS[rule.action]} size="small" />
                  </TableCell>
                  <TableCell>{rule.scope || 'Global'}</TableCell>
                  <TableCell>{rule.priority}</TableCell>
                  <TableCell>
                    <Chip label={rule.enabled ? 'On' : 'Off'} size="small" color={rule.enabled ? 'success' : 'default'} variant="outlined" />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => handleOpenEdit(rule)}><EditIcon fontSize="small" /></IconButton>
                    <IconButton size="small" color="error" onClick={() => handleDelete(rule.id)}><DeleteIcon fontSize="small" /></IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingRule ? 'Edit Firewall Rule' : 'Create Firewall Rule'}</DialogTitle>
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
            <TextField
              label="Pattern (Regex)"
              size="small"
              fullWidth
              required
              value={formData.pattern}
              onChange={(e) => setFormData({ ...formData, pattern: e.target.value })}
              helperText="Regular expression pattern to match against SQL queries"
              slotProps={{ htmlInput: { style: { fontFamily: 'monospace' } } }}
            />
            <FormControl size="small" fullWidth>
              <InputLabel>Action</InputLabel>
              <Select
                value={formData.action}
                label="Action"
                onChange={(e) => setFormData({ ...formData, action: e.target.value as FirewallAction })}
              >
                <MenuItem value="BLOCK">Block - Deny execution</MenuItem>
                <MenuItem value="ALERT">Alert - Allow but notify</MenuItem>
                <MenuItem value="LOG">Log - Allow and log only</MenuItem>
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
            <TextField
              label="Description"
              size="small"
              fullWidth
              multiline
              rows={2}
              value={formData.description || ''}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
            <TextField
              label="Priority"
              size="small"
              type="number"
              value={formData.priority ?? 0}
              onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value, 10) || 0 })}
              helperText="Higher priority rules are evaluated first"
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
            disabled={saving || !formData.name || !formData.pattern}
          >
            {saving ? <CircularProgress size={20} /> : editingRule ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
