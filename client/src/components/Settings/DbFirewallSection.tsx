import { useState, useEffect, useCallback } from 'react';
import {
  Card, CardContent, Typography, Box, Button, Stack,
  Table, TableHead, TableBody, TableRow, TableCell,
  Chip, IconButton, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, FormControl, InputLabel,
  Select, MenuItem, Switch, FormControlLabel, Alert,
  CircularProgress, Tooltip, Divider, ListSubheader,
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

// ---------------------------------------------------------------------------
// Preset rule templates
// ---------------------------------------------------------------------------

interface RuleTemplate {
  name: string;
  pattern: string;
  action: FirewallAction;
  description: string;
  category: string;
}

const MAX_REGEX_LENGTH = 500;
const NESTED_QUANTIFIER_RE = /(\+|\*|\{[^}]+\})\s*\)?\s*(\+|\*|\?|\{[^}]+\})/;

const RULE_TEMPLATES: RuleTemplate[] = [
  // --- Destructive DDL ---
  {
    category: 'Destructive Operations',
    name: 'Block DROP TABLE',
    pattern: '\\bDROP\\s+TABLE\\b',
    action: 'BLOCK',
    description: 'Prevents dropping database tables',
  },
  {
    category: 'Destructive Operations',
    name: 'Block TRUNCATE',
    pattern: '\\bTRUNCATE\\b',
    action: 'BLOCK',
    description: 'Prevents truncating tables (deletes all rows without logging)',
  },
  {
    category: 'Destructive Operations',
    name: 'Block DROP DATABASE',
    pattern: '\\bDROP\\s+DATABASE\\b',
    action: 'BLOCK',
    description: 'Prevents dropping entire databases',
  },
  {
    category: 'Destructive Operations',
    name: 'Block DROP SCHEMA',
    pattern: '\\bDROP\\s+SCHEMA\\b',
    action: 'BLOCK',
    description: 'Prevents dropping database schemas',
  },
  // --- Data Modification ---
  {
    category: 'Data Modification',
    name: 'Alert DELETE without WHERE',
    pattern: '^\\s*DELETE\\s+FROM\\s+\\S+\\s*;?\\s*$',
    action: 'ALERT',
    description: 'Alerts when a DELETE statement has no WHERE clause (deletes all rows)',
  },
  {
    category: 'Data Modification',
    name: 'Alert UPDATE without WHERE',
    pattern: '^\\s*UPDATE\\s+\\S+\\s+SET\\s+.*(?<!WHERE\\s+.*)\\s*;?\\s*$',
    action: 'ALERT',
    description: 'Alerts when an UPDATE statement has no WHERE clause (updates all rows)',
  },
  {
    category: 'Data Modification',
    name: 'Log all INSERT statements',
    pattern: '\\bINSERT\\s+INTO\\b',
    action: 'LOG',
    description: 'Logs all INSERT operations for audit purposes',
  },
  // --- Schema Changes ---
  {
    category: 'Schema Changes',
    name: 'Alert ALTER TABLE',
    pattern: '\\bALTER\\s+TABLE\\b',
    action: 'ALERT',
    description: 'Alerts on table schema modifications (add/drop columns, rename)',
  },
  {
    category: 'Schema Changes',
    name: 'Block CREATE/DROP INDEX',
    pattern: '\\b(CREATE|DROP)\\s+(UNIQUE\\s+)?INDEX\\b',
    action: 'BLOCK',
    description: 'Prevents index modifications that can impact performance',
  },
  {
    category: 'Schema Changes',
    name: 'Alert GRANT/REVOKE',
    pattern: '\\b(GRANT|REVOKE)\\b',
    action: 'ALERT',
    description: 'Alerts when database permissions are being modified',
  },
  // --- Security ---
  {
    category: 'Security',
    name: 'Block SQL comment injection',
    pattern: '(--|/\\*|\\*/)',
    action: 'BLOCK',
    description: 'Blocks queries containing SQL comment syntax often used in injection attacks',
  },
  {
    category: 'Security',
    name: 'Block UNION-based injection',
    pattern: '\\bUNION\\s+(ALL\\s+)?SELECT\\b',
    action: 'BLOCK',
    description: 'Blocks UNION SELECT patterns commonly used in SQL injection',
  },
  {
    category: 'Security',
    name: 'Block system table access',
    pattern: '\\b(pg_catalog|information_schema|sys\\.objects|sysobjects|mysql\\.user)\\b',
    action: 'BLOCK',
    description: 'Blocks direct access to system catalog tables',
  },
  // --- Performance ---
  {
    category: 'Performance',
    name: 'Alert SELECT * (bulk read)',
    pattern: '^\\s*SELECT\\s+\\*\\s+FROM\\s+\\S+\\s*;?\\s*$',
    action: 'ALERT',
    description: 'Alerts on unfiltered SELECT * queries that may return large result sets',
  },
  {
    category: 'Performance',
    name: 'Alert CROSS JOIN',
    pattern: '\\bCROSS\\s+JOIN\\b',
    action: 'ALERT',
    description: 'Alerts on CROSS JOIN which produces cartesian products',
  },
];

// ---------------------------------------------------------------------------
// Regex validation helper
// ---------------------------------------------------------------------------

function validateRegex(pattern: string): string | null {
  const trimmed = pattern.trim();
  if (!trimmed) return 'Pattern is required';
  if (trimmed.length > MAX_REGEX_LENGTH || NESTED_QUANTIFIER_RE.test(trimmed)) {
    return 'Pattern is too complex or too long';
  }
  try {
    // Intentional validation of user-authored regex before it is sent to the API.
    // eslint-disable-next-line security/detect-non-literal-regexp
    new RegExp(trimmed, 'i');
    return null;
  } catch (err) {
    return err instanceof SyntaxError ? err.message : 'Invalid regular expression';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DbFirewallSection() {
  const [rules, setRules] = useState<FirewallRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<FirewallRule | null>(null);
  const [patternError, setPatternError] = useState<string | null>(null);
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
    setPatternError(null);
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
    setPatternError(null);
    clearError();
    setEditOpen(true);
  };

  const handlePatternChange = (value: string) => {
    setFormData({ ...formData, pattern: value });
    if (value.trim()) {
      setPatternError(validateRegex(value));
    } else {
      setPatternError(null);
    }
  };

  const handleApplyTemplate = (templateValue: string) => {
    const template = RULE_TEMPLATES.find((t) => t.name === templateValue);
    if (!template) return;
    setFormData({
      ...formData,
      name: template.name,
      pattern: template.pattern,
      action: template.action,
      description: template.description,
    });
    setPatternError(validateRegex(template.pattern));
  };

  const handleSave = async () => {
    // Validate regex before saving
    const regexErr = validateRegex(formData.pattern);
    if (regexErr) {
      setPatternError(regexErr);
      return;
    }

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

  // Group templates by category for the Select menu
  const templateMenuItems: React.ReactNode[] = [];
  let lastCategory = '';
  for (const t of RULE_TEMPLATES) {
    if (t.category !== lastCategory) {
      templateMenuItems.push(<ListSubheader key={`cat-${t.category}`}>{t.category}</ListSubheader>);
      lastCategory = t.category;
    }
    templateMenuItems.push(
      <MenuItem key={t.name} value={t.name}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
          <Chip label={t.action} color={ACTION_COLORS[t.action]} size="small" sx={{ minWidth: 56 }} />
          <Typography variant="body2">{t.name}</Typography>
        </Box>
      </MenuItem>,
    );
  }

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

            {/* Template selector — only shown when creating */}
            {!editingRule && (
              <>
                <FormControl size="small" fullWidth>
                  <InputLabel>Start from template (optional)</InputLabel>
                  <Select
                    value=""
                    label="Start from template (optional)"
                    onChange={(e) => handleApplyTemplate(e.target.value)}
                  >
                    {templateMenuItems}
                  </Select>
                </FormControl>
                <Divider />
              </>
            )}

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
              onChange={(e) => handlePatternChange(e.target.value)}
              error={!!patternError}
              helperText={patternError || 'Regular expression pattern to match against SQL queries (case-insensitive)'}
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
            disabled={saving || !formData.name || !formData.pattern || !!patternError}
          >
            {saving ? <CircularProgress size={20} /> : editingRule ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
