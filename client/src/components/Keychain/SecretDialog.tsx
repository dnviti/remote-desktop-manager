import { useState, useEffect, useRef } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  FormControl, InputLabel, Select, MenuItem, Box, Alert, Typography,
  IconButton, InputAdornment, Chip,
} from '@mui/material';
import {
  Visibility, VisibilityOff, Casino as GenerateIcon,
  UploadFile as UploadIcon, Add as AddIcon, Delete as DeleteIcon,
} from '@mui/icons-material';
import { useSecretStore } from '../../store/secretStore';
import { useAuthStore } from '../../store/authStore';
import { useTeamStore } from '../../store/teamStore';
import type { SecretDetail, SecretType, SecretScope, SecretPayload } from '../../api/secrets.api';
import type { TenantVaultStatus } from '../../api/secrets.api';

interface SecretDialogProps {
  open: boolean;
  onClose: () => void;
  secret?: SecretDetail | null;
}

function generatePassword(length = 20): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*_-+=';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => chars[b % chars.length]).join('');
}

export default function SecretDialog({ open, onClose, secret }: SecretDialogProps) {
  const createSecret = useSecretStore((s) => s.createSecret);
  const updateSecret = useSecretStore((s) => s.updateSecret);
  const tenantVaultStatus: TenantVaultStatus | null = useSecretStore((s) => s.tenantVaultStatus);
  const user = useAuthStore((s) => s.user);
  const teams = useTeamStore((s) => s.teams);
  const fetchTeams = useTeamStore((s) => s.fetchTeams);

  const isEditMode = !!secret;

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<SecretType>('LOGIN');
  const [scope, setScope] = useState<SecretScope>('PERSONAL');
  const [teamId, setTeamId] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  // Type-specific data
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginUrl, setLoginUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [sshPrivateKey, setSshPrivateKey] = useState('');
  const [sshPublicKey, setSshPublicKey] = useState('');
  const [sshPassphrase, setSshPassphrase] = useState('');
  const [sshAlgorithm, setSshAlgorithm] = useState('');
  const [sshUsername, setSshUsername] = useState('');

  const [certCertificate, setCertCertificate] = useState('');
  const [certPrivateKey, setCertPrivateKey] = useState('');
  const [certChain, setCertChain] = useState('');
  const [certPassphrase, setCertPassphrase] = useState('');
  const [certExpiresAt, setCertExpiresAt] = useState('');

  const [apiKeyValue, setApiKeyValue] = useState('');
  const [apiKeyEndpoint, setApiKeyEndpoint] = useState('');
  const [apiKeyHeaders, setApiKeyHeaders] = useState<Array<{ key: string; value: string }>>([]);

  const [noteContent, setNoteContent] = useState('');

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileTarget, setFileTarget] = useState<string>('');

  useEffect(() => {
    if (open) {
      if (teams.length === 0 && user?.tenantId) {
        fetchTeams();
      }
      if (secret) {
        setName(secret.name);
        setDescription(secret.description || '');
        setType(secret.type);
        setScope(secret.scope);
        setTeamId(secret.teamId || '');
        setTags(secret.tags || []);
        setExpiresAt(secret.expiresAt ? secret.expiresAt.slice(0, 16) : '');
        populateData(secret.data);
      } else {
        resetForm();
      }
      setError('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only trigger on open/close and secret change
  }, [open, secret]);

  const resetForm = () => {
    setName('');
    setDescription('');
    setType('LOGIN');
    setScope('PERSONAL');
    setTeamId('');
    setTags([]);
    setTagInput('');
    setExpiresAt('');
    setLoginUsername('');
    setLoginPassword('');
    setLoginUrl('');
    setNotes('');
    setShowPassword(false);
    setSshPrivateKey('');
    setSshPublicKey('');
    setSshPassphrase('');
    setSshAlgorithm('');
    setSshUsername('');
    setCertCertificate('');
    setCertPrivateKey('');
    setCertChain('');
    setCertPassphrase('');
    setCertExpiresAt('');
    setApiKeyValue('');
    setApiKeyEndpoint('');
    setApiKeyHeaders([]);
    setNoteContent('');
  };

  const populateData = (data: SecretPayload) => {
    switch (data.type) {
      case 'LOGIN':
        setLoginUsername(data.username);
        setLoginPassword(data.password);
        setLoginUrl(data.url || '');
        setNotes(data.notes || '');
        break;
      case 'SSH_KEY':
        setSshUsername(data.username || '');
        setSshPrivateKey(data.privateKey);
        setSshPublicKey(data.publicKey || '');
        setSshPassphrase(data.passphrase || '');
        setSshAlgorithm(data.algorithm || '');
        setNotes(data.notes || '');
        break;
      case 'CERTIFICATE':
        setCertCertificate(data.certificate);
        setCertPrivateKey(data.privateKey);
        setCertChain(data.chain || '');
        setCertPassphrase(data.passphrase || '');
        setCertExpiresAt(data.expiresAt || '');
        setNotes(data.notes || '');
        break;
      case 'API_KEY':
        setApiKeyValue(data.apiKey);
        setApiKeyEndpoint(data.endpoint || '');
        setApiKeyHeaders(
          data.headers
            ? Object.entries(data.headers).map(([key, value]) => ({ key, value }))
            : [],
        );
        setNotes(data.notes || '');
        break;
      case 'SECURE_NOTE':
        setNoteContent(data.content);
        break;
    }
  };

  const buildPayload = (): SecretPayload | null => {
    switch (type) {
      case 'LOGIN':
        if (!loginUsername || !loginPassword) { setError('Username and password are required'); return null; }
        return { type: 'LOGIN', username: loginUsername, password: loginPassword, url: loginUrl || undefined, notes: notes || undefined };
      case 'SSH_KEY':
        if (!sshPrivateKey) { setError('Private key is required'); return null; }
        return { type: 'SSH_KEY', username: sshUsername || undefined, privateKey: sshPrivateKey, publicKey: sshPublicKey || undefined, passphrase: sshPassphrase || undefined, algorithm: sshAlgorithm || undefined, notes: notes || undefined };
      case 'CERTIFICATE':
        if (!certCertificate || !certPrivateKey) { setError('Certificate and private key are required'); return null; }
        return { type: 'CERTIFICATE', certificate: certCertificate, privateKey: certPrivateKey, chain: certChain || undefined, passphrase: certPassphrase || undefined, expiresAt: certExpiresAt || undefined, notes: notes || undefined };
      case 'API_KEY':
        if (!apiKeyValue) { setError('API key is required'); return null; }
        const headers = apiKeyHeaders.reduce<Record<string, string>>((acc, h) => {
          if (h.key.trim()) acc[h.key.trim()] = h.value;
          return acc;
        }, {});
        return { type: 'API_KEY', apiKey: apiKeyValue, endpoint: apiKeyEndpoint || undefined, headers: Object.keys(headers).length > 0 ? headers : undefined, notes: notes || undefined };
      case 'SECURE_NOTE':
        if (!noteContent) { setError('Content is required'); return null; }
        return { type: 'SECURE_NOTE', content: noteContent };
    }
  };

  const handleSubmit = async () => {
    setError('');
    if (!name.trim()) { setError('Name is required'); return; }
    if (scope === 'TEAM' && !teamId) { setError('Please select a team'); return; }

    const payload = buildPayload();
    if (!payload) return;

    setLoading(true);
    try {
      if (isEditMode && secret) {
        await updateSecret(secret.id, {
          name: name.trim(),
          description: description.trim() || null,
          data: payload,
          tags,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        });
      } else {
        await createSecret({
          name: name.trim(),
          description: description.trim() || undefined,
          type,
          scope,
          teamId: scope === 'TEAM' ? teamId : undefined,
          data: payload,
          tags: tags.length > 0 ? tags : undefined,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        });
      }
      onClose();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (isEditMode ? 'Failed to update secret' : 'Failed to create secret');
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleAddTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) {
      setTags([...tags, t]);
    }
    setTagInput('');
  };

  const handleFileUpload = (target: string) => {
    setFileTarget(target);
    fileInputRef.current?.click();
  };

  const handleFileRead = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      switch (fileTarget) {
        case 'sshPrivateKey': setSshPrivateKey(content); break;
        case 'sshPublicKey': setSshPublicKey(content); break;
        case 'certCertificate': setCertCertificate(content); break;
        case 'certPrivateKey': setCertPrivateKey(content); break;
        case 'certChain': setCertChain(content); break;
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const canSelectTeam = user?.tenantId && teams.length > 0;
  const canSelectTenant = user?.tenantId && (user.tenantRole === 'OWNER' || user.tenantRole === 'ADMIN');
  const tenantVaultReady = tenantVaultStatus?.initialized && tenantVaultStatus?.hasAccess;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEditMode ? 'Edit Secret' : 'New Secret'}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          {/* Type selector — only on create */}
          {!isEditMode && (
            <FormControl fullWidth size="small">
              <InputLabel>Type</InputLabel>
              <Select value={type} label="Type" onChange={(e) => setType(e.target.value as SecretType)}>
                <MenuItem value="LOGIN">Login</MenuItem>
                <MenuItem value="SSH_KEY">SSH Key</MenuItem>
                <MenuItem value="CERTIFICATE">Certificate</MenuItem>
                <MenuItem value="API_KEY">API Key</MenuItem>
                <MenuItem value="SECURE_NOTE">Secure Note</MenuItem>
              </Select>
            </FormControl>
          )}

          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} fullWidth required size="small" />
          <TextField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} fullWidth size="small" />

          {/* Scope selector — only on create */}
          {!isEditMode && (
            <FormControl fullWidth size="small">
              <InputLabel>Scope</InputLabel>
              <Select value={scope} label="Scope" onChange={(e) => setScope(e.target.value as SecretScope)}>
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

          {!isEditMode && scope === 'TEAM' && (
            <FormControl fullWidth size="small">
              <InputLabel>Team</InputLabel>
              <Select value={teamId} label="Team" onChange={(e) => setTeamId(e.target.value)}>
                {teams.map((t) => (
                  <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          {/* Dynamic data section */}
          {type === 'LOGIN' && (
            <>
              <TextField label="Username" value={loginUsername} onChange={(e) => setLoginUsername(e.target.value)} fullWidth required size="small" />
              <TextField
                label="Password"
                type={showPassword ? 'text' : 'password'}
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                fullWidth required size="small"
                slotProps={{
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton size="small" onClick={() => setShowPassword(!showPassword)}>
                          {showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                        </IconButton>
                        <IconButton size="small" onClick={() => { setLoginPassword(generatePassword()); setShowPassword(true); }} title="Generate password">
                          <GenerateIcon fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    ),
                  },
                }}
              />
              <TextField label="URL" value={loginUrl} onChange={(e) => setLoginUrl(e.target.value)} fullWidth size="small" />
            </>
          )}

          {type === 'SSH_KEY' && (
            <>
              <TextField label="Username" value={sshUsername} onChange={(e) => setSshUsername(e.target.value)} fullWidth size="small" />
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">Private Key *</Typography>
                  <IconButton size="small" onClick={() => handleFileUpload('sshPrivateKey')} title="Upload file">
                    <UploadIcon fontSize="small" />
                  </IconButton>
                </Box>
                <TextField
                  value={sshPrivateKey}
                  onChange={(e) => setSshPrivateKey(e.target.value)}
                  fullWidth required multiline rows={4} size="small"
                  placeholder="Paste PEM private key or upload file..."
                />
              </Box>
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">Public Key</Typography>
                  <IconButton size="small" onClick={() => handleFileUpload('sshPublicKey')} title="Upload file">
                    <UploadIcon fontSize="small" />
                  </IconButton>
                </Box>
                <TextField value={sshPublicKey} onChange={(e) => setSshPublicKey(e.target.value)} fullWidth multiline rows={2} size="small" />
              </Box>
              <TextField label="Passphrase" value={sshPassphrase} onChange={(e) => setSshPassphrase(e.target.value)} fullWidth size="small" type="password" />
              <FormControl fullWidth size="small">
                <InputLabel>Algorithm</InputLabel>
                <Select value={sshAlgorithm} label="Algorithm" onChange={(e) => setSshAlgorithm(e.target.value)}>
                  <MenuItem value="">Not specified</MenuItem>
                  <MenuItem value="RSA">RSA</MenuItem>
                  <MenuItem value="ED25519">ED25519</MenuItem>
                  <MenuItem value="ECDSA">ECDSA</MenuItem>
                  <MenuItem value="DSA">DSA</MenuItem>
                </Select>
              </FormControl>
            </>
          )}

          {type === 'CERTIFICATE' && (
            <>
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">Certificate *</Typography>
                  <IconButton size="small" onClick={() => handleFileUpload('certCertificate')} title="Upload file">
                    <UploadIcon fontSize="small" />
                  </IconButton>
                </Box>
                <TextField value={certCertificate} onChange={(e) => setCertCertificate(e.target.value)} fullWidth required multiline rows={4} size="small" placeholder="Paste PEM certificate or upload .crt/.pem..." />
              </Box>
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">Private Key *</Typography>
                  <IconButton size="small" onClick={() => handleFileUpload('certPrivateKey')} title="Upload file">
                    <UploadIcon fontSize="small" />
                  </IconButton>
                </Box>
                <TextField value={certPrivateKey} onChange={(e) => setCertPrivateKey(e.target.value)} fullWidth required multiline rows={4} size="small" placeholder="Paste PEM private key or upload .key..." />
              </Box>
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">CA Chain</Typography>
                  <IconButton size="small" onClick={() => handleFileUpload('certChain')} title="Upload file">
                    <UploadIcon fontSize="small" />
                  </IconButton>
                </Box>
                <TextField value={certChain} onChange={(e) => setCertChain(e.target.value)} fullWidth multiline rows={2} size="small" />
              </Box>
              <TextField label="Passphrase" value={certPassphrase} onChange={(e) => setCertPassphrase(e.target.value)} fullWidth size="small" type="password" />
              <TextField
                label="Certificate Expires At"
                type="datetime-local"
                value={certExpiresAt}
                onChange={(e) => setCertExpiresAt(e.target.value)}
                fullWidth size="small"
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </>
          )}

          {type === 'API_KEY' && (
            <>
              <TextField label="API Key" value={apiKeyValue} onChange={(e) => setApiKeyValue(e.target.value)} fullWidth required size="small" type="password" />
              <TextField label="Endpoint URL" value={apiKeyEndpoint} onChange={(e) => setApiKeyEndpoint(e.target.value)} fullWidth size="small" />
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Typography variant="caption" color="text.secondary">Headers</Typography>
                  <IconButton size="small" onClick={() => setApiKeyHeaders([...apiKeyHeaders, { key: '', value: '' }])}>
                    <AddIcon fontSize="small" />
                  </IconButton>
                </Box>
                {apiKeyHeaders.map((h, i) => (
                  <Box key={i} sx={{ display: 'flex', gap: 1, mb: 1 }}>
                    <TextField
                      label="Key"
                      value={h.key}
                      onChange={(e) => {
                        const updated = [...apiKeyHeaders];
                        updated[i] = { ...updated[i], key: e.target.value };
                        setApiKeyHeaders(updated);
                      }}
                      size="small" sx={{ flex: 1 }}
                    />
                    <TextField
                      label="Value"
                      value={h.value}
                      onChange={(e) => {
                        const updated = [...apiKeyHeaders];
                        updated[i] = { ...updated[i], value: e.target.value };
                        setApiKeyHeaders(updated);
                      }}
                      size="small" sx={{ flex: 1 }}
                    />
                    <IconButton size="small" onClick={() => setApiKeyHeaders(apiKeyHeaders.filter((_, j) => j !== i))}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Box>
                ))}
              </Box>
            </>
          )}

          {type === 'SECURE_NOTE' && (
            <TextField
              label="Content"
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              fullWidth required multiline rows={6} size="small"
            />
          )}

          {type !== 'SECURE_NOTE' && (
            <TextField label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} fullWidth multiline rows={2} size="small" />
          )}

          {/* Tags */}
          <Box>
            <Box sx={{ display: 'flex', gap: 1, mb: 0.5 }}>
              <TextField
                label="Tags"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); } }}
                size="small" fullWidth
                placeholder="Press Enter to add"
              />
              <Button size="small" onClick={handleAddTag}>Add</Button>
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {tags.map((t) => (
                <Chip key={t} label={t} size="small" onDelete={() => setTags(tags.filter((x) => x !== t))} />
              ))}
            </Box>
          </Box>

          {/* Expiry */}
          <TextField
            label="Expires At"
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            fullWidth size="small"
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Box>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pem,.key,.crt,.pub,.txt"
          style={{ display: 'none' }}
          onChange={handleFileRead}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button onClick={handleSubmit} variant="contained" disabled={loading}>
          {loading ? (isEditMode ? 'Saving...' : 'Creating...') : (isEditMode ? 'Save' : 'Create')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
