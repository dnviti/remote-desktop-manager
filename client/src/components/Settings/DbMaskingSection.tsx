import { useState, useEffect, useCallback } from 'react';
import {
  Card, CardContent, Typography, Box, Button, Stack,
  Table, TableHead, TableBody, TableRow, TableCell,
  Chip, IconButton, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, FormControl, InputLabel,
  Select, MenuItem, Switch, FormControlLabel, Alert,
  CircularProgress, Tooltip, OutlinedInput, SelectChangeEvent,
  Divider, ListSubheader,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  VisibilityOff as MaskIcon,
} from '@mui/icons-material';
import {
  getMaskingPolicies, createMaskingPolicy, updateMaskingPolicy, deleteMaskingPolicy,
  MaskingPolicy, MaskingPolicyInput, MaskingStrategy,
} from '../../api/dbAudit.api';
import { useAsyncAction } from '../../hooks/useAsyncAction';

const STRATEGY_LABELS: Record<MaskingStrategy, string> = {
  REDACT: 'Full Redaction',
  HASH: 'Hash (SHA-256)',
  PARTIAL: 'Partial Mask',
};

const STRATEGY_COLORS: Record<MaskingStrategy, 'error' | 'warning' | 'info'> = {
  REDACT: 'error',
  HASH: 'warning',
  PARTIAL: 'info',
};

const ROLE_OPTIONS = ['OWNER', 'ADMIN', 'OPERATOR', 'MEMBER', 'CONSULTANT', 'AUDITOR', 'GUEST'];

// ---------------------------------------------------------------------------
// Preset masking policy templates
// ---------------------------------------------------------------------------

interface MaskingTemplate {
  name: string;
  columnPattern: string;
  strategy: MaskingStrategy;
  description: string;
  category: string;
}

const MASKING_TEMPLATES: MaskingTemplate[] = [
  // --- PII / Identity ---
  {
    category: 'PII / Identity',
    name: 'Mask SSN / National ID',
    columnPattern: '(ssn|social_security|national_id|tax_id|identity_number)',
    strategy: 'PARTIAL',
    description: 'Partially masks social security numbers and national identifiers',
  },
  {
    category: 'PII / Identity',
    name: 'Redact Full Names',
    columnPattern: '(full_name|first_name|last_name|surname|given_name)',
    strategy: 'REDACT',
    description: 'Fully redacts personal name columns',
  },
  {
    category: 'PII / Identity',
    name: 'Hash Personal Identifiers',
    columnPattern: '(passport|driver_license|license_number)',
    strategy: 'HASH',
    description: 'Hashes government-issued ID numbers for pseudonymized analytics',
  },
  // --- Financial ---
  {
    category: 'Financial',
    name: 'Mask Credit Cards',
    columnPattern: '(credit_card|card_number|pan|cc_number)',
    strategy: 'PARTIAL',
    description: 'Shows only the last digits of payment card numbers',
  },
  {
    category: 'Financial',
    name: 'Redact Bank Accounts',
    columnPattern: '(bank_account|iban|routing_number|sort_code|account_number)',
    strategy: 'REDACT',
    description: 'Fully redacts banking and financial account numbers',
  },
  {
    category: 'Financial',
    name: 'Redact Salary / Compensation',
    columnPattern: '(salary|wage|compensation|income|bonus)',
    strategy: 'REDACT',
    description: 'Hides salary and compensation data from non-privileged users',
  },
  // --- Authentication ---
  {
    category: 'Authentication',
    name: 'Redact Passwords',
    columnPattern: '(password|passwd|pwd|secret|pin)',
    strategy: 'REDACT',
    description: 'Fully redacts password and secret columns',
  },
  {
    category: 'Authentication',
    name: 'Hash API Keys / Tokens',
    columnPattern: '(api_key|access_key|secret_key|auth_token|refresh_token)',
    strategy: 'HASH',
    description: 'Hashes API keys and tokens for reference without exposing raw values',
  },
  // --- Contact Information ---
  {
    category: 'Contact Information',
    name: 'Mask Email Addresses',
    columnPattern: '(email|e_mail|email_address)',
    strategy: 'PARTIAL',
    description: 'Partially masks email addresses showing domain only',
  },
  {
    category: 'Contact Information',
    name: 'Mask Phone Numbers',
    columnPattern: '(phone|telephone|mobile|cell|fax)',
    strategy: 'PARTIAL',
    description: 'Partially masks phone numbers showing last digits only',
  },
  {
    category: 'Contact Information',
    name: 'Redact Physical Addresses',
    columnPattern: '(address|street|city|zip_code|postal_code)',
    strategy: 'REDACT',
    description: 'Fully redacts physical address components',
  },
  // --- Healthcare ---
  {
    category: 'Healthcare',
    name: 'Redact Medical Records',
    columnPattern: '(diagnosis|medical_record|patient_id|health_id)',
    strategy: 'REDACT',
    description: 'Fully redacts protected health information (PHI)',
  },
  {
    category: 'Healthcare',
    name: 'Hash Prescription Data',
    columnPattern: '(prescription|medication|drug_name)',
    strategy: 'HASH',
    description: 'Hashes prescription data for pseudonymized research use',
  },
];

export default function DbMaskingSection() {
  const [policies, setPolicies] = useState<MaskingPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<MaskingPolicy | null>(null);
  const [formData, setFormData] = useState<MaskingPolicyInput>({
    name: '',
    columnPattern: '',
    strategy: 'REDACT',
    exemptRoles: [],
    scope: '',
    description: '',
    enabled: true,
  });
  const { loading: saving, error, run, clearError } = useAsyncAction();

  const fetchPolicies = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getMaskingPolicies();
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
    setFormData({ name: '', columnPattern: '', strategy: 'REDACT', exemptRoles: [], scope: '', description: '', enabled: true });
    clearError();
    setEditOpen(true);
  };

  const handleApplyTemplate = (templateValue: string) => {
    const template = MASKING_TEMPLATES.find((t) => t.name === templateValue);
    if (!template) return;
    setFormData({
      ...formData,
      name: template.name,
      columnPattern: template.columnPattern,
      strategy: template.strategy,
      description: template.description,
    });
  };

  const handleOpenEdit = (policy: MaskingPolicy) => {
    setEditingPolicy(policy);
    setFormData({
      name: policy.name,
      columnPattern: policy.columnPattern,
      strategy: policy.strategy,
      exemptRoles: policy.exemptRoles,
      scope: policy.scope || '',
      description: policy.description || '',
      enabled: policy.enabled,
    });
    clearError();
    setEditOpen(true);
  };

  const handleSave = async () => {
    const ok = await run(async () => {
      if (editingPolicy) {
        await updateMaskingPolicy(editingPolicy.id, formData);
      } else {
        await createMaskingPolicy(formData);
      }
    }, 'Failed to save masking policy');

    if (ok) {
      setEditOpen(false);
      fetchPolicies();
    }
  };

  const handleDelete = async (policyId: string) => {
    await run(async () => {
      await deleteMaskingPolicy(policyId);
      fetchPolicies();
    }, 'Failed to delete masking policy');
  };

  const handleRolesChange = (event: SelectChangeEvent<string[]>) => {
    const value = event.target.value;
    setFormData({ ...formData, exemptRoles: typeof value === 'string' ? value.split(',') : value });
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <MaskIcon color="primary" />
            <Typography variant="subtitle1" fontWeight="bold">Data Masking Policies</Typography>
          </Box>
          <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={handleOpenCreate}>
            Add Policy
          </Button>
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Define column-level masking rules to redact sensitive data in database query results.
          Columns matching the regex pattern will have their values masked based on the selected strategy.
          Role-based exemptions allow specific tenant roles to see unmasked values.
        </Typography>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        ) : policies.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
            No masking policies configured.
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Column Pattern</TableCell>
                <TableCell>Strategy</TableCell>
                <TableCell>Scope</TableCell>
                <TableCell>Exempt Roles</TableCell>
                <TableCell>Enabled</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {policies.map((policy) => (
                <TableRow key={policy.id}>
                  <TableCell>{policy.name}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8rem', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <Tooltip title={policy.columnPattern}><span>{policy.columnPattern}</span></Tooltip>
                  </TableCell>
                  <TableCell>
                    <Chip label={STRATEGY_LABELS[policy.strategy]} color={STRATEGY_COLORS[policy.strategy]} size="small" />
                  </TableCell>
                  <TableCell>{policy.scope || 'Global'}</TableCell>
                  <TableCell>
                    {policy.exemptRoles.length > 0
                      ? policy.exemptRoles.map((r) => <Chip key={r} label={r} size="small" variant="outlined" sx={{ mr: 0.5, mb: 0.5 }} />)
                      : 'None'}
                  </TableCell>
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
        <DialogTitle>{editingPolicy ? 'Edit Masking Policy' : 'Create Masking Policy'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}

            {/* Template selector — only shown when creating */}
            {!editingPolicy && (
              <>
                <FormControl size="small" fullWidth>
                  <InputLabel>Start from template (optional)</InputLabel>
                  <Select
                    value=""
                    label="Start from template (optional)"
                    onChange={(e) => handleApplyTemplate(e.target.value)}
                  >
                    {(() => {
                      const items: React.ReactNode[] = [];
                      let lastCategory = '';
                      for (const t of MASKING_TEMPLATES) {
                        if (t.category !== lastCategory) {
                          items.push(<ListSubheader key={`cat-${t.category}`}>{t.category}</ListSubheader>);
                          lastCategory = t.category;
                        }
                        items.push(
                          <MenuItem key={t.name} value={t.name}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                              <Chip label={STRATEGY_LABELS[t.strategy]} color={STRATEGY_COLORS[t.strategy]} size="small" sx={{ minWidth: 72 }} />
                              <Typography variant="body2">{t.name}</Typography>
                            </Box>
                          </MenuItem>,
                        );
                      }
                      return items;
                    })()}
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
              label="Column Pattern (Regex)"
              size="small"
              fullWidth
              required
              value={formData.columnPattern}
              onChange={(e) => setFormData({ ...formData, columnPattern: e.target.value })}
              helperText="Regex to match column names, e.g. (password|ssn|credit_card|email)"
              slotProps={{ htmlInput: { style: { fontFamily: 'monospace' } } }}
            />
            <FormControl size="small" fullWidth>
              <InputLabel>Masking Strategy</InputLabel>
              <Select
                value={formData.strategy}
                label="Masking Strategy"
                onChange={(e) => setFormData({ ...formData, strategy: e.target.value as MaskingStrategy })}
              >
                <MenuItem value="REDACT">Redact - Replace with ***REDACTED***</MenuItem>
                <MenuItem value="HASH">Hash - SHA-256 truncated hash</MenuItem>
                <MenuItem value="PARTIAL">Partial - Show first 25% of characters</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth>
              <InputLabel>Exempt Roles</InputLabel>
              <Select
                multiple
                value={formData.exemptRoles || []}
                label="Exempt Roles"
                onChange={handleRolesChange}
                input={<OutlinedInput label="Exempt Roles" />}
                renderValue={(selected) => (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {selected.map((value) => (
                      <Chip key={value} label={value} size="small" />
                    ))}
                  </Box>
                )}
              >
                {ROLE_OPTIONS.map((role) => (
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
            <TextField
              label="Description"
              size="small"
              fullWidth
              multiline
              rows={2}
              value={formData.description || ''}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
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
            disabled={saving || !formData.name || !formData.columnPattern}
          >
            {saving ? <CircularProgress size={20} /> : editingPolicy ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
