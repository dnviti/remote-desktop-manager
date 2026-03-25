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
  ExternalVaultType, ExternalVaultAuthMethod,
} from '../../api/externalVault.api';
import { extractApiError } from '../../utils/apiError';

// ---------- Provider / auth method metadata ----------

interface AuthMethodMeta {
  value: ExternalVaultAuthMethod;
  label: string;
}

interface ProviderMeta {
  value: ExternalVaultType;
  label: string;
  authMethods: AuthMethodMeta[];
  defaultMount: string;
  serverUrlPlaceholder: string;
  serverUrlLabel: string;
  secretPathHelp: string;
}

const PROVIDERS: ProviderMeta[] = [
  {
    value: 'HASHICORP_VAULT',
    label: 'HashiCorp Vault',
    authMethods: [
      { value: 'TOKEN', label: 'Static Token' },
      { value: 'APPROLE', label: 'AppRole' },
    ],
    defaultMount: 'secret',
    serverUrlPlaceholder: 'https://vault.example.com:8200',
    serverUrlLabel: 'Server URL',
    secretPathHelp: 'Path within the KV v2 mount, e.g. "servers/web1"',
  },
  {
    value: 'AWS_SECRETS_MANAGER',
    label: 'AWS Secrets Manager',
    authMethods: [
      { value: 'IAM_ACCESS_KEY', label: 'IAM Access Key' },
      { value: 'IAM_ROLE', label: 'IAM Role (IRSA / Instance Profile)' },
    ],
    defaultMount: '',
    serverUrlPlaceholder: 'https://secretsmanager.us-east-1.amazonaws.com',
    serverUrlLabel: 'Endpoint URL',
    secretPathHelp: 'Secret name or ARN. Append #AWSPREVIOUS for previous version.',
  },
  {
    value: 'AZURE_KEY_VAULT',
    label: 'Azure Key Vault',
    authMethods: [
      { value: 'CLIENT_CREDENTIALS', label: 'Service Principal (Client Credentials)' },
      { value: 'MANAGED_IDENTITY', label: 'Managed Identity' },
    ],
    defaultMount: '',
    serverUrlPlaceholder: 'https://myvault.vault.azure.net',
    serverUrlLabel: 'Vault URI',
    secretPathHelp: 'Secret name, optionally with version: "my-secret" or "my-secret/version-id"',
  },
  {
    value: 'GCP_SECRET_MANAGER',
    label: 'GCP Secret Manager',
    authMethods: [
      { value: 'SERVICE_ACCOUNT_KEY', label: 'Service Account Key (JSON)' },
      { value: 'WORKLOAD_IDENTITY', label: 'Workload Identity' },
    ],
    defaultMount: '',
    serverUrlPlaceholder: 'https://secretmanager.googleapis.com',
    serverUrlLabel: 'Server URL',
    secretPathHelp: 'Secret name, e.g. "my-secret" or "my-secret/versions/5"',
  },
  {
    value: 'CYBERARK_CONJUR',
    label: 'CyberArk Conjur',
    authMethods: [
      { value: 'CONJUR_API_KEY', label: 'API Key' },
      { value: 'CONJUR_AUTHN_K8S', label: 'Kubernetes Auth (authn-k8s)' },
    ],
    defaultMount: '',
    serverUrlPlaceholder: 'https://conjur.example.com',
    serverUrlLabel: 'Conjur URL',
    secretPathHelp: 'Variable ID with policy path, e.g. "myapp/db/password"',
  },
];

function getProviderMeta(type: ExternalVaultType): ProviderMeta {
  return PROVIDERS.find((p) => p.value === type) ?? PROVIDERS[0];
}

function providerLabel(type: ExternalVaultType): string {
  return getProviderMeta(type).label;
}

// ---------- Auth credential fields per method ----------

interface AuthFieldProps {
  authMethod: ExternalVaultAuthMethod;
  isEdit: boolean;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}

function AuthFields({ authMethod, isEdit, values, onChange }: AuthFieldProps) {
  const placeholder = isEdit ? 'Leave blank to keep unchanged' : undefined;
  const required = !isEdit;

  switch (authMethod) {
    case 'TOKEN':
      return (
        <TextField label="Vault Token" value={values.token ?? ''} onChange={(e) => onChange('token', e.target.value)}
          fullWidth type="password" required={required} placeholder={placeholder} />
      );
    case 'APPROLE':
      return (
        <>
          <TextField label="Role ID" value={values.roleId ?? ''} onChange={(e) => onChange('roleId', e.target.value)}
            fullWidth required={required} placeholder={placeholder} />
          <TextField label="Secret ID" value={values.secretId ?? ''} onChange={(e) => onChange('secretId', e.target.value)}
            fullWidth type="password" required={required} placeholder={placeholder} />
        </>
      );
    case 'IAM_ACCESS_KEY':
      return (
        <>
          <TextField label="Access Key ID" value={values.accessKeyId ?? ''} onChange={(e) => onChange('accessKeyId', e.target.value)}
            fullWidth required={required} placeholder={placeholder} />
          <TextField label="Secret Access Key" value={values.secretAccessKey ?? ''} onChange={(e) => onChange('secretAccessKey', e.target.value)}
            fullWidth type="password" required={required} placeholder={placeholder} />
          <TextField label="Region" value={values.region ?? ''} onChange={(e) => onChange('region', e.target.value)}
            fullWidth placeholder="us-east-1 (default)" />
        </>
      );
    case 'IAM_ROLE':
      return (
        <>
          <TextField label="Region" value={values.region ?? ''} onChange={(e) => onChange('region', e.target.value)}
            fullWidth placeholder="us-east-1 (default)" />
          <TextField label="Role ARN (optional)" value={values.roleArn ?? ''} onChange={(e) => onChange('roleArn', e.target.value)}
            fullWidth placeholder="arn:aws:iam::123456789:role/my-role" />
          <Typography variant="caption" color="text.secondary">
            Credentials are sourced from the environment (IRSA, instance profile, or env vars).
          </Typography>
        </>
      );
    case 'CLIENT_CREDENTIALS':
      return (
        <>
          <TextField label="Azure Tenant ID" value={values.tenantId ?? ''} onChange={(e) => onChange('tenantId', e.target.value)}
            fullWidth required={required} placeholder={placeholder} />
          <TextField label="Client ID" value={values.clientId ?? ''} onChange={(e) => onChange('clientId', e.target.value)}
            fullWidth required={required} placeholder={placeholder} />
          <TextField label="Client Secret" value={values.clientSecret ?? ''} onChange={(e) => onChange('clientSecret', e.target.value)}
            fullWidth type="password" required={required} placeholder={placeholder} />
        </>
      );
    case 'MANAGED_IDENTITY':
      return (
        <>
          <TextField label="Client ID (optional)" value={values.clientId ?? ''} onChange={(e) => onChange('clientId', e.target.value)}
            fullWidth placeholder="Leave blank for system-assigned identity" />
          <Typography variant="caption" color="text.secondary">
            Uses the Azure IMDS endpoint. Only works when running on Azure.
          </Typography>
        </>
      );
    case 'SERVICE_ACCOUNT_KEY':
      return (
        <>
          <TextField label="Service Account Key (JSON)" value={values.serviceAccountKey ?? ''} onChange={(e) => onChange('serviceAccountKey', e.target.value)}
            fullWidth multiline rows={4} required={required} placeholder={isEdit ? 'Leave blank to keep unchanged' : 'Paste full JSON key file'} />
          <TextField label="Project ID (optional, derived from key)" value={values.projectId ?? ''} onChange={(e) => onChange('projectId', e.target.value)}
            fullWidth />
        </>
      );
    case 'WORKLOAD_IDENTITY':
      return (
        <>
          <TextField label="Project ID" value={values.projectId ?? ''} onChange={(e) => onChange('projectId', e.target.value)}
            fullWidth required={required} placeholder={placeholder} />
          <Typography variant="caption" color="text.secondary">
            Uses GCE metadata server. Only works when running on GCP with Workload Identity.
          </Typography>
        </>
      );
    case 'CONJUR_API_KEY':
      return (
        <>
          <TextField label="Account" value={values.account ?? ''} onChange={(e) => onChange('account', e.target.value)}
            fullWidth required={required} placeholder={placeholder} />
          <TextField label="Login (Host ID)" value={values.login ?? ''} onChange={(e) => onChange('login', e.target.value)}
            fullWidth required={required} placeholder={placeholder} />
          <TextField label="API Key" value={values.apiKey ?? ''} onChange={(e) => onChange('apiKey', e.target.value)}
            fullWidth type="password" required={required} placeholder={placeholder} />
        </>
      );
    case 'CONJUR_AUTHN_K8S':
      return (
        <>
          <TextField label="Account" value={values.account ?? ''} onChange={(e) => onChange('account', e.target.value)}
            fullWidth required={required} placeholder={placeholder} />
          <TextField label="Service ID (authn-k8s)" value={values.serviceId ?? ''} onChange={(e) => onChange('serviceId', e.target.value)}
            fullWidth required={required} placeholder={placeholder} />
          <TextField label="Host ID (optional)" value={values.hostId ?? ''} onChange={(e) => onChange('hostId', e.target.value)}
            fullWidth />
          <Typography variant="caption" color="text.secondary">
            Uses the Kubernetes service account token for authentication.
          </Typography>
        </>
      );
    default:
      return null;
  }
}

/** Auth methods that rely on environment/platform credentials and don't require user-supplied secrets. */
const AUTH_METHODS_NO_CREDENTIALS_REQUIRED: Set<ExternalVaultAuthMethod> = new Set([
  'IAM_ROLE',
  'MANAGED_IDENTITY',
  'WORKLOAD_IDENTITY',
]);

// ---------- Component ----------

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
  const [testProviderType, setTestProviderType] = useState<ExternalVaultType>('HASHICORP_VAULT');
  const [testPath, setTestPath] = useState('');
  const [testResult, setTestResult] = useState<{ success: boolean; keys?: string[]; error?: string } | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formProviderType, setFormProviderType] = useState<ExternalVaultType>('HASHICORP_VAULT');
  const [formUrl, setFormUrl] = useState('');
  const [formAuth, setFormAuth] = useState<ExternalVaultAuthMethod>('TOKEN');
  const [formNamespace, setFormNamespace] = useState('');
  const [formMount, setFormMount] = useState('secret');
  const [formAuthValues, setFormAuthValues] = useState<Record<string, string>>({});
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

  const resetForm = (providerType: ExternalVaultType = 'HASHICORP_VAULT') => {
    const meta = getProviderMeta(providerType);
    setFormProviderType(providerType);
    setFormAuth(meta.authMethods[0].value);
    setFormMount(meta.defaultMount);
    setFormAuthValues({});
    setFormCaCert('');
    setFormError('');
  };

  const openCreateDialog = () => {
    setEditingProvider(null);
    setFormName('');
    setFormUrl('');
    setFormNamespace('');
    setFormCacheTtl('300');
    resetForm('HASHICORP_VAULT');
    setDialogOpen(true);
  };

  const openEditDialog = (p: VaultProviderData) => {
    setEditingProvider(p);
    setFormName(p.name);
    setFormProviderType(p.providerType);
    setFormUrl(p.serverUrl);
    setFormAuth(p.authMethod);
    setFormNamespace(p.namespace ?? '');
    setFormMount(p.mountPath);
    setFormAuthValues({});
    setFormCacheTtl(String(p.cacheTtlSeconds));
    setFormCaCert('');
    setFormError('');
    setDialogOpen(true);
  };

  const handleProviderTypeChange = (type: ExternalVaultType) => {
    resetForm(type);
    setFormUrl('');
    setFormNamespace('');
  };

  const handleAuthChange = (key: string, value: string) => {
    setFormAuthValues((prev) => ({ ...prev, [key]: value }));
  };

  const buildAuthPayload = (): string => {
    // Filter out empty values to keep payload clean
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(formAuthValues)) {
      if (v) clean[k] = v;
    }
    return JSON.stringify(clean);
  };

  const hasAuthCredentials = (): boolean => {
    return Object.values(formAuthValues).some((v) => v.length > 0);
  };

  const requiresAuthCredentials = (): boolean => {
    return !AUTH_METHODS_NO_CREDENTIALS_REQUIRED.has(formAuth);
  };

  const handleSave = async () => {
    if (!formName || !formUrl) {
      setFormError('Name and Server URL / Region are required');
      return;
    }

    if (requiresAuthCredentials() && !hasAuthCredentials() && !editingProvider) {
      setFormError('Authentication credentials are required');
      return;
    }

    try {
      setSaving(true);
      if (editingProvider) {
        const input: UpdateVaultProviderInput = {
          name: formName,
          providerType: formProviderType,
          serverUrl: formUrl,
          authMethod: formAuth,
          namespace: formNamespace || null,
          mountPath: formMount,
          cacheTtlSeconds: parseInt(formCacheTtl, 10) || 300,
          ...(formCaCert ? { caCertificate: formCaCert } : {}),
        };
        if (hasAuthCredentials()) input.authPayload = buildAuthPayload();
        await updateVaultProvider(editingProvider.id, input);
      } else {
        const input: CreateVaultProviderInput = {
          name: formName,
          providerType: formProviderType,
          serverUrl: formUrl,
          authMethod: formAuth,
          authPayload: buildAuthPayload(),
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

  const openTestDialog = (providerId: string, providerType: ExternalVaultType) => {
    setTestProviderId(providerId);
    setTestProviderType(providerType);
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

  const meta = getProviderMeta(formProviderType);

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
          No external vault providers configured. Add a provider to reference credentials stored in HashiCorp Vault, AWS Secrets Manager, Azure Key Vault, GCP Secret Manager, or CyberArk Conjur.
        </Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Provider</TableCell>
              <TableCell>Server URL</TableCell>
              <TableCell>Auth</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {providers.map((p) => (
              <TableRow key={p.id}>
                <TableCell>{p.name}</TableCell>
                <TableCell>
                  <Chip label={providerLabel(p.providerType)} size="small" variant="outlined" />
                </TableCell>
                <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.serverUrl}
                </TableCell>
                <TableCell>
                  <Chip label={p.authMethod} size="small" variant="outlined" />
                </TableCell>
                <TableCell>
                  {p.enabled
                    ? <Chip icon={<CheckCircleIcon />} label="Enabled" size="small" color="success" variant="outlined" />
                    : <Chip icon={<CancelIcon />} label="Disabled" size="small" color="default" variant="outlined" />}
                </TableCell>
                <TableCell align="right">
                  <Tooltip title="Test Connection">
                    <IconButton size="small" onClick={() => openTestDialog(p.id, p.providerType)}>
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

            <FormControl fullWidth>
              <InputLabel>Provider Type</InputLabel>
              <Select value={formProviderType} label="Provider Type" disabled={!!editingProvider}
                onChange={(e) => handleProviderTypeChange(e.target.value as ExternalVaultType)}>
                {PROVIDERS.map((p) => (
                  <MenuItem key={p.value} value={p.value}>{p.label}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField label={meta.serverUrlLabel} value={formUrl} onChange={(e) => setFormUrl(e.target.value)}
              fullWidth required placeholder={meta.serverUrlPlaceholder} />

            <FormControl fullWidth>
              <InputLabel>Auth Method</InputLabel>
              <Select value={formAuth} label="Auth Method" onChange={(e) => {
                setFormAuth(e.target.value as ExternalVaultAuthMethod);
                setFormAuthValues({});
              }}>
                {meta.authMethods.map((am) => (
                  <MenuItem key={am.value} value={am.value}>{am.label}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <AuthFields authMethod={formAuth} isEdit={!!editingProvider} values={formAuthValues} onChange={handleAuthChange} />

            {formProviderType === 'HASHICORP_VAULT' && (
              <TextField label="Namespace (optional)" value={formNamespace} onChange={(e) => setFormNamespace(e.target.value)} fullWidth />
            )}

            {meta.defaultMount !== '' && (
              <TextField label="Mount Path" value={formMount} onChange={(e) => setFormMount(e.target.value)} fullWidth />
            )}

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
              placeholder={getProviderMeta(testProviderType).secretPathHelp.replace(/^.*?e\.g\.\s*/, '').replace(/"$/, '') || 'e.g. servers/web1'}
              helperText={getProviderMeta(testProviderType).secretPathHelp}
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
