import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Button, IconButton, Table, TableHead, TableBody, TableRow, TableCell,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Alert, Chip,
  FormControl, InputLabel, Select, MenuItem, Switch, Tooltip,
} from '@mui/material';
import {
  Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon,
  CheckCircle as CheckCircleIcon, Cancel as CancelIcon,
  Science as TestIcon,
} from '@mui/icons-material';
import {
  listVaultProviders, createVaultProvider, updateVaultProvider, deleteVaultProvider,
  testVaultProvider, VaultProviderData, CreateVaultProviderInput, UpdateVaultProviderInput,
} from '../../api/externalVault.api';
import { extractApiError } from '../../utils/apiError';

interface VaultProvidersSectionProps {
  tenantId: string;
}

export default function VaultProvidersSection({ tenantId }: VaultProvidersSectionProps) {
  const [providers, setProviders] = useState<VaultProviderData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<VaultProviderData | null>(null);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testProviderId, setTestProviderId] = useState('');
  const [testPath, setTestPath] = useState('');
  const [testResult, setTestResult] = useState<{ success: boolean; keys?: string[]; error?: string } | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formAuth, setFormAuth] = useState<'TOKEN' | 'APPROLE'>('TOKEN');
  const [formNamespace, setFormNamespace] = useState('');
  const [formMount, setFormMount] = useState('secret');
  const [formToken, setFormToken] = useState('');
  const [formRoleId, setFormRoleId] = useState('');
  const [formSecretId, setFormSecretId] = useState('');
  const [formCacheTtl, setFormCacheTtl] = useState('300');
  const [formCaCert, setFormCaCert] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchProviders = useCallback(async () => {
    try {
      setLoading(true);
      const data = await listVaultProviders();
      setProviders(data);
    } catch (err) {
      setError(extractApiError(err, 'Failed to load vault providers'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tenantId) fetchProviders();
  }, [tenantId, fetchProviders]);

  const openCreateDialog = () => {
    setEditingProvider(null);
    setFormName('');
    setFormUrl('');
    setFormAuth('TOKEN');
    setFormNamespace('');
    setFormMount('secret');
    setFormToken('');
    setFormRoleId('');
    setFormSecretId('');
    setFormCacheTtl('300');
    setFormCaCert('');
    setFormError('');
    setDialogOpen(true);
  };

  const openEditDialog = (p: VaultProviderData) => {
    setEditingProvider(p);
    setFormName(p.name);
    setFormUrl(p.serverUrl);
    setFormAuth(p.authMethod);
    setFormNamespace(p.namespace ?? '');
    setFormMount(p.mountPath);
    setFormToken('');
    setFormRoleId('');
    setFormSecretId('');
    setFormCacheTtl(String(p.cacheTtlSeconds));
    setFormCaCert('');
    setFormError('');
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formName || !formUrl) {
      setFormError('Name and Server URL are required');
      return;
    }

    let authPayload: string;
    if (formAuth === 'TOKEN') {
      if (!formToken && !editingProvider) { setFormError('Token is required'); return; }
      authPayload = JSON.stringify({ token: formToken });
    } else {
      if ((!formRoleId || !formSecretId) && !editingProvider) { setFormError('Role ID and Secret ID are required'); return; }
      authPayload = JSON.stringify({ roleId: formRoleId, secretId: formSecretId });
    }

    try {
      setSaving(true);
      if (editingProvider) {
        const input: UpdateVaultProviderInput = {
          name: formName,
          serverUrl: formUrl,
          authMethod: formAuth,
          namespace: formNamespace || null,
          mountPath: formMount,
          cacheTtlSeconds: parseInt(formCacheTtl, 10) || 300,
          ...(formCaCert ? { caCertificate: formCaCert } : {}),
        };
        // Only send authPayload if credentials were re-entered
        if (formAuth === 'TOKEN' && formToken) input.authPayload = authPayload;
        if (formAuth === 'APPROLE' && formRoleId && formSecretId) input.authPayload = authPayload;
        await updateVaultProvider(editingProvider.id, input);
      } else {
        const input: CreateVaultProviderInput = {
          name: formName,
          serverUrl: formUrl,
          authMethod: formAuth,
          authPayload,
          ...(formNamespace ? { namespace: formNamespace } : {}),
          mountPath: formMount,
          cacheTtlSeconds: parseInt(formCacheTtl, 10) || 300,
          ...(formCaCert ? { caCertificate: formCaCert } : {}),
        };
        await createVaultProvider(input);
      }
      setDialogOpen(false);
      await fetchProviders();
    } catch (err) {
      setFormError(extractApiError(err, 'Failed to save vault provider'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteVaultProvider(id);
      await fetchProviders();
    } catch (err) {
      setError(extractApiError(err, 'Failed to delete vault provider'));
    }
  };

  const handleToggleEnabled = async (p: VaultProviderData) => {
    try {
      await updateVaultProvider(p.id, { enabled: !p.enabled });
      await fetchProviders();
    } catch (err) {
      setError(extractApiError(err, 'Failed to toggle vault provider'));
    }
  };

  const openTestDialog = (providerId: string) => {
    setTestProviderId(providerId);
    setTestPath('');
    setTestResult(null);
    setTestDialogOpen(true);
  };

  const handleTest = async () => {
    try {
      setTestLoading(true);
      setTestResult(null);
      const result = await testVaultProvider(testProviderId, testPath);
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, error: extractApiError(err, 'Test failed') });
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={600}>External Vault Providers</Typography>
        <Button size="small" startIcon={<AddIcon />} onClick={openCreateDialog}>Add Provider</Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {loading ? (
        <Typography variant="body2" color="text.secondary">Loading...</Typography>
      ) : providers.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No external vault providers configured. Add a HashiCorp Vault provider to reference credentials stored externally.
        </Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Server URL</TableCell>
              <TableCell>Auth</TableCell>
              <TableCell>Mount</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {providers.map((p) => (
              <TableRow key={p.id}>
                <TableCell>{p.name}</TableCell>
                <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.serverUrl}
                </TableCell>
                <TableCell>
                  <Chip label={p.authMethod} size="small" variant="outlined" />
                </TableCell>
                <TableCell>{p.mountPath}</TableCell>
                <TableCell>
                  {p.enabled
                    ? <Chip icon={<CheckCircleIcon />} label="Enabled" size="small" color="success" variant="outlined" />
                    : <Chip icon={<CancelIcon />} label="Disabled" size="small" color="default" variant="outlined" />}
                </TableCell>
                <TableCell align="right">
                  <Tooltip title="Test Connection">
                    <IconButton size="small" onClick={() => openTestDialog(p.id)}>
                      <TestIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={p.enabled ? 'Disable' : 'Enable'}>
                    <Switch size="small" checked={p.enabled} onChange={() => handleToggleEnabled(p)} />
                  </Tooltip>
                  <Tooltip title="Edit">
                    <IconButton size="small" onClick={() => openEditDialog(p)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete">
                    <IconButton size="small" color="error" onClick={() => handleDelete(p.id)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingProvider ? 'Edit Vault Provider' : 'Add Vault Provider'}</DialogTitle>
        <DialogContent>
          {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField label="Name" value={formName} onChange={(e) => setFormName(e.target.value)} fullWidth required />
            <TextField label="Server URL" value={formUrl} onChange={(e) => setFormUrl(e.target.value)} fullWidth required placeholder="https://vault.example.com:8200" />
            <FormControl fullWidth>
              <InputLabel>Auth Method</InputLabel>
              <Select value={formAuth} label="Auth Method" onChange={(e) => {
                const newMethod = e.target.value as 'TOKEN' | 'APPROLE';
                setFormAuth(newMethod);
                if (editingProvider) {
                  // Clear credential fields when switching auth method in edit mode
                  setFormToken('');
                  setFormRoleId('');
                  setFormSecretId('');
                }
              }}>
                <MenuItem value="TOKEN">Static Token</MenuItem>
                <MenuItem value="APPROLE">AppRole</MenuItem>
              </Select>
            </FormControl>
            {formAuth === 'TOKEN' ? (
              <TextField
                label="Vault Token"
                value={formToken}
                onChange={(e) => setFormToken(e.target.value)}
                fullWidth
                type="password"
                required={!editingProvider}
                placeholder={editingProvider ? 'Leave blank to keep unchanged' : undefined}
              />
            ) : (
              <>
                <TextField
                  label="Role ID"
                  value={formRoleId}
                  onChange={(e) => setFormRoleId(e.target.value)}
                  fullWidth
                  required={!editingProvider}
                  placeholder={editingProvider ? 'Leave blank to keep unchanged' : undefined}
                />
                <TextField
                  label="Secret ID"
                  value={formSecretId}
                  onChange={(e) => setFormSecretId(e.target.value)}
                  fullWidth
                  type="password"
                  required={!editingProvider}
                  placeholder={editingProvider ? 'Leave blank to keep unchanged' : undefined}
                />
              </>
            )}
            <TextField label="Namespace (optional)" value={formNamespace} onChange={(e) => setFormNamespace(e.target.value)} fullWidth />
            <TextField label="Mount Path" value={formMount} onChange={(e) => setFormMount(e.target.value)} fullWidth />
            <TextField label="Cache TTL (seconds)" value={formCacheTtl} onChange={(e) => setFormCacheTtl(e.target.value)} type="number" fullWidth />
            <TextField
              label="CA Certificate (optional)"
              value={formCaCert}
              onChange={(e) => setFormCaCert(e.target.value)}
              fullWidth
              multiline
              rows={3}
              placeholder="PEM-encoded CA certificate for custom TLS"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleSave} variant="contained" disabled={saving}>
            {saving ? 'Saving...' : (editingProvider ? 'Save' : 'Create')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Test Dialog */}
      <Dialog open={testDialogOpen} onClose={() => setTestDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Test Vault Connection</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              label="Secret Path"
              value={testPath}
              onChange={(e) => setTestPath(e.target.value)}
              fullWidth
              placeholder="e.g. servers/web1"
              helperText="Path to the secret within the KV v2 mount"
            />
            {testResult && (
              <Alert severity={testResult.success ? 'success' : 'error'}>
                {testResult.success
                  ? `Connection successful. Keys found: ${testResult.keys?.join(', ') ?? 'none'}`
                  : `Connection failed: ${testResult.error}`}
              </Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTestDialogOpen(false)}>Close</Button>
          <Button onClick={handleTest} variant="contained" disabled={testLoading || !testPath}>
            {testLoading ? 'Testing...' : 'Test'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
