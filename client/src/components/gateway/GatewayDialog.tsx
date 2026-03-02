import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Box, Alert,
  FormControl, InputLabel, Select, MenuItem, FormControlLabel, Checkbox,
} from '@mui/material';
import { useGatewayStore } from '../../store/gatewayStore';
import type { GatewayData } from '../../api/gateway.api';

interface GatewayDialogProps {
  open: boolean;
  onClose: () => void;
  gateway?: GatewayData | null;
}

export default function GatewayDialog({ open, onClose, gateway }: GatewayDialogProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'GUACD' | 'SSH_BASTION' | 'MANAGED_SSH'>('GUACD');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [description, setDescription] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [sshPrivateKey, setSshPrivateKey] = useState('');
  const [apiPort, setApiPort] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const createGateway = useGatewayStore((s) => s.createGateway);
  const updateGateway = useGatewayStore((s) => s.updateGateway);

  const isEditMode = Boolean(gateway);

  useEffect(() => {
    if (open && gateway) {
      setName(gateway.name);
      setType(gateway.type);
      setHost(gateway.host);
      setPort(String(gateway.port));
      setDescription(gateway.description || '');
      setIsDefault(gateway.isDefault);
      setUsername('');
      setPassword('');
      setSshPrivateKey('');
      setApiPort(gateway.apiPort ? String(gateway.apiPort) : '');
    } else if (open) {
      setName('');
      setType('GUACD');
      setHost('');
      setPort('');
      setDescription('');
      setIsDefault(false);
      setUsername('');
      setPassword('');
      setSshPrivateKey('');
      setApiPort('');
    }
    setError('');
  }, [open, gateway]);

  const handleTypeChange = (newType: 'GUACD' | 'SSH_BASTION' | 'MANAGED_SSH') => {
    setType(newType);
    const defaultPort = newType === 'GUACD' ? '4822' : newType === 'MANAGED_SSH' ? '2222' : '22';
    if (!port || port === '4822' || port === '22' || port === '2222') {
      setPort(defaultPort);
    }
    if (newType === 'MANAGED_SSH' && !apiPort) {
      setApiPort('8022');
    } else if (newType !== 'MANAGED_SSH') {
      setApiPort('');
    }
  };

  const handleSubmit = async () => {
    setError('');
    if (!name.trim()) {
      setError('Gateway name is required');
      return;
    }
    if (!host.trim()) {
      setError('Host is required');
      return;
    }
    const portNum = parseInt(port, 10);
    if (!port || isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setError('Port must be between 1 and 65535');
      return;
    }

    setLoading(true);
    try {
      if (isEditMode && gateway) {
        const data: Record<string, unknown> = {};
        if (name.trim() !== gateway.name) data.name = name.trim();
        if (host.trim() !== gateway.host) data.host = host.trim();
        if (portNum !== gateway.port) data.port = portNum;
        if ((description.trim() || null) !== gateway.description) {
          data.description = description.trim() || null;
        }
        if (isDefault !== gateway.isDefault) data.isDefault = isDefault;
        if (gateway.type === 'MANAGED_SSH') {
          const newApiPort = apiPort ? parseInt(apiPort, 10) : null;
          if (newApiPort !== gateway.apiPort) data.apiPort = newApiPort;
        }
        if (type === 'SSH_BASTION') {
          if (username) data.username = username;
          if (password) data.password = password;
          if (sshPrivateKey) data.sshPrivateKey = sshPrivateKey;
        }
        await updateGateway(gateway.id, data);
      } else {
        const apiPortNum = apiPort ? parseInt(apiPort, 10) : undefined;
        await createGateway({
          name: name.trim(),
          type,
          host: host.trim(),
          port: portNum,
          description: description.trim() || undefined,
          isDefault: isDefault || undefined,
          ...(type === 'SSH_BASTION' && username ? { username } : {}),
          ...(type === 'SSH_BASTION' && password ? { password } : {}),
          ...(type === 'SSH_BASTION' && sshPrivateKey ? { sshPrivateKey } : {}),
          ...(type === 'MANAGED_SSH' && apiPortNum ? { apiPort: apiPortNum } : {}),
        });
      }
      handleClose();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (isEditMode ? 'Failed to update gateway' : 'Failed to create gateway');
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setName('');
    setType('GUACD');
    setHost('');
    setPort('');
    setDescription('');
    setIsDefault(false);
    setUsername('');
    setPassword('');
    setSshPrivateKey('');
    setApiPort('');
    setError('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>{isEditMode ? 'Edit Gateway' : 'New Gateway'}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
            autoFocus
            inputProps={{ maxLength: 100 }}
          />
          <FormControl fullWidth>
            <InputLabel>Type</InputLabel>
            <Select
              value={type}
              label="Type"
              onChange={(e) => handleTypeChange(e.target.value as 'GUACD' | 'SSH_BASTION' | 'MANAGED_SSH')}
              disabled={isEditMode}
            >
              <MenuItem value="GUACD">GUACD (RDP Gateway)</MenuItem>
              <MenuItem value="SSH_BASTION">SSH Bastion (Jump Host)</MenuItem>
              <MenuItem value="MANAGED_SSH">Managed SSH Gateway</MenuItem>
            </Select>
          </FormControl>
          {type === 'MANAGED_SSH' && (
            <Alert severity="info">
              This gateway uses the server&apos;s SSH key pair for authentication. No credentials needed.
            </Alert>
          )}
          {type === 'MANAGED_SSH' && (
            <TextField
              label="API Port (sidecar)"
              value={apiPort}
              onChange={(e) => setApiPort(e.target.value)}
              type="number"
              fullWidth
              helperText="HTTP port for the key management sidecar (default: 8022)"
            />
          )}
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              label="Host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              fullWidth
              required
            />
            <TextField
              label="Port"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              type="number"
              sx={{ width: 120 }}
            />
          </Box>
          {type === 'SSH_BASTION' && (
            <>
              <TextField
                label="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                fullWidth
                placeholder={isEditMode ? 'Leave blank to keep unchanged' : undefined}
              />
              <TextField
                label="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                fullWidth
                placeholder={isEditMode ? 'Leave blank to keep unchanged' : undefined}
              />
              <TextField
                label="SSH Private Key (PEM)"
                value={sshPrivateKey}
                onChange={(e) => setSshPrivateKey(e.target.value)}
                fullWidth
                multiline
                rows={4}
                placeholder={
                  isEditMode
                    ? gateway?.hasSshKey
                      ? 'Key configured — leave blank to keep unchanged'
                      : 'Paste PEM-encoded private key'
                    : 'Paste PEM-encoded private key (optional)'
                }
                slotProps={{ htmlInput: { style: { fontFamily: 'monospace', fontSize: '0.8rem' } } }}
              />
            </>
          )}
          <TextField
            label="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            multiline
            rows={2}
            inputProps={{ maxLength: 500 }}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
              />
            }
            label={`Set as default ${type === 'GUACD' ? 'GUACD' : type === 'MANAGED_SSH' ? 'Managed SSH' : 'SSH Bastion'} gateway`}
          />
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
