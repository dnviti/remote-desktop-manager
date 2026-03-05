import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  FormControl, InputLabel, Select, MenuItem, Box, Alert,
  FormControlLabel, Checkbox, Accordion, AccordionSummary, AccordionDetails, Typography,
  ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import { ExpandMore as ExpandMoreIcon, Keyboard, VpnKey } from '@mui/icons-material';
import { createConnection, updateConnection, ConnectionInput, ConnectionUpdate, ConnectionData } from '../../api/connections.api';
import { useConnectionsStore } from '../../store/connectionsStore';
import type { SshTerminalConfig } from '../../constants/terminalThemes';
import { mergeTerminalConfig } from '../../constants/terminalThemes';
import { useTerminalSettingsStore } from '../../store/terminalSettingsStore';
import TerminalSettingsSection from '../Settings/TerminalSettingsSection';
import type { RdpSettings } from '../../constants/rdpDefaults';
import { mergeRdpConfig } from '../../constants/rdpDefaults';
import { useRdpSettingsStore } from '../../store/rdpSettingsStore';
import RdpSettingsSection from '../Settings/RdpSettingsSection';
import { useGatewayStore } from '../../store/gatewayStore';
import { useAuthStore } from '../../store/authStore';
import SecretPicker from '../Keychain/SecretPicker';
import { useVaultStore } from '../../store/vaultStore';

interface ConnectionDialogProps {
  open: boolean;
  onClose: () => void;
  connection?: ConnectionData | null;
  folderId?: string | null;
  teamId?: string | null;
}

export default function ConnectionDialog({ open, onClose, connection, folderId, teamId }: ConnectionDialogProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'SSH' | 'RDP'>('SSH');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [description, setDescription] = useState('');
  const [enableDrive, setEnableDrive] = useState(false);
  const [sshTerminalConfig, setSshTerminalConfig] = useState<Partial<SshTerminalConfig>>({});
  const [rdpSettings, setRdpSettings] = useState<Partial<RdpSettings>>({});
  const [gatewayId, setGatewayId] = useState('');
  const [credentialMode, setCredentialMode] = useState<'manual' | 'keychain'>('manual');
  const [selectedSecretId, setSelectedSecretId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const fetchConnections = useConnectionsStore((s) => s.fetchConnections);
  const userDefaults = useTerminalSettingsStore((s) => s.userDefaults);
  const rdpUserDefaults = useRdpSettingsStore((s) => s.userDefaults);
  const gateways = useGatewayStore((s) => s.gateways);
  const fetchGateways = useGatewayStore((s) => s.fetchGateways);
  const hasTenant = Boolean(useAuthStore((s) => s.user)?.tenantId);
  const vaultUnlocked = useVaultStore((s) => s.unlocked);

  const isEditMode = Boolean(connection);

  useEffect(() => {
    if (open && hasTenant) fetchGateways();
    if (open && connection) {
      setName(connection.name);
      setType(connection.type);
      setHost(connection.host);
      setPort(String(connection.port));
      setUsername('');
      setPassword('');
      setDescription(connection.description || '');
      setEnableDrive(connection.enableDrive ?? false);
      setGatewayId(connection.gatewayId || '');
      setSshTerminalConfig(
        (connection.sshTerminalConfig as Partial<SshTerminalConfig>) ?? {}
      );
      setRdpSettings(
        (connection.rdpSettings as Partial<RdpSettings>) ?? {}
      );
      if (connection.credentialSecretId) {
        setCredentialMode('keychain');
        setSelectedSecretId(connection.credentialSecretId);
      } else {
        setCredentialMode('manual');
        setSelectedSecretId(null);
      }
    } else if (open && !connection) {
      setName('');
      setType('SSH');
      setHost('');
      setPort('22');
      setUsername('');
      setPassword('');
      setDescription('');
      setEnableDrive(false);
      setGatewayId('');
      setSshTerminalConfig({});
      setRdpSettings({});
      setCredentialMode('manual');
      setSelectedSecretId(null);
    }
  }, [open, connection]);

  const handleTypeChange = (newType: 'SSH' | 'RDP') => {
    setType(newType);
    if (newType === 'SSH' && port === '3389') setPort('22');
    if (newType === 'RDP' && port === '22') setPort('3389');
    setGatewayId('');
  };

  const availableGateways = gateways.filter((g) => {
    if (type === 'SSH') return g.type === 'SSH_BASTION' || g.type === 'MANAGED_SSH';
    if (type === 'RDP') return g.type === 'GUACD';
    return false;
  });

  const handleSubmit = async () => {
    setError('');
    if (!name || !host) {
      setError('Name and host are required');
      return;
    }
    if (credentialMode === 'keychain' && !selectedSecretId) {
      setError('Please select a secret from the keychain');
      return;
    }
    if (credentialMode === 'manual' && !isEditMode && !username) {
      setError('Username is required for new connections');
      return;
    }

    setLoading(true);
    try {
      if (isEditMode && connection) {
        const data: ConnectionUpdate = {
          name,
          type,
          host,
          port: parseInt(port, 10),
          description: description || null,
          enableDrive,
          gatewayId: gatewayId || null,
          credentialSecretId: credentialMode === 'keychain' ? selectedSecretId : null,
          ...(type === 'SSH' && {
            sshTerminalConfig: Object.keys(sshTerminalConfig).length > 0 ? sshTerminalConfig : null,
          }),
          ...(type === 'RDP' && {
            rdpSettings: Object.keys(rdpSettings).length > 0 ? rdpSettings : null,
          }),
        };
        if (credentialMode === 'manual') {
          if (username) data.username = username;
          if (password) data.password = password;
        }
        await updateConnection(connection.id, data);
      } else {
        const data: ConnectionInput = {
          name,
          type,
          host,
          port: parseInt(port, 10),
          description: description || undefined,
          enableDrive,
          gatewayId: gatewayId || null,
          ...(credentialMode === 'keychain'
            ? { credentialSecretId: selectedSecretId! }
            : { username, password }),
          ...(folderId ? { folderId } : {}),
          ...(teamId ? { teamId } : {}),
          ...(type === 'SSH' && Object.keys(sshTerminalConfig).length > 0 && {
            sshTerminalConfig,
          }),
          ...(type === 'RDP' && Object.keys(rdpSettings).length > 0 && {
            rdpSettings,
          }),
        };
        await createConnection(data);
      }
      await fetchConnections();
      handleClose();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (isEditMode ? 'Failed to update connection' : 'Failed to create connection');
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setName('');
    setType('SSH');
    setHost('');
    setPort('22');
    setUsername('');
    setPassword('');
    setDescription('');
    setEnableDrive(false);
    setGatewayId('');
    setSshTerminalConfig({});
    setRdpSettings({});
    setCredentialMode('manual');
    setSelectedSecretId(null);
    setError('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEditMode ? 'Edit Connection' : 'New Connection'}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
          />
          <FormControl fullWidth>
            <InputLabel>Type</InputLabel>
            <Select
              value={type}
              label="Type"
              onChange={(e) => handleTypeChange(e.target.value as 'SSH' | 'RDP')}
              disabled={isEditMode}
            >
              <MenuItem value="SSH">SSH</MenuItem>
              <MenuItem value="RDP">RDP</MenuItem>
            </Select>
          </FormControl>
          {hasTenant && availableGateways.length > 0 && (
            <FormControl fullWidth>
              <InputLabel>Gateway (optional)</InputLabel>
              <Select
                value={gatewayId}
                label="Gateway (optional)"
                onChange={(e) => setGatewayId(e.target.value)}
              >
                <MenuItem value="">None (Direct connection)</MenuItem>
                {availableGateways.map((gw) => (
                  <MenuItem key={gw.id} value={gw.id}>
                    {gw.name} — {gw.host}:{gw.port}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
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
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
              Credentials
            </Typography>
            <ToggleButtonGroup
              value={credentialMode}
              exclusive
              onChange={(_e, val) => { if (val) setCredentialMode(val); }}
              size="small"
              fullWidth
            >
              <ToggleButton value="manual">
                <Keyboard fontSize="small" sx={{ mr: 0.5 }} /> Manual
              </ToggleButton>
              <ToggleButton value="keychain" disabled={!vaultUnlocked}>
                <VpnKey fontSize="small" sx={{ mr: 0.5 }} /> From Keychain
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>
          {credentialMode === 'keychain' ? (
            <SecretPicker
              value={selectedSecretId}
              onChange={(id) => setSelectedSecretId(id)}
              connectionType={type}
              error={!selectedSecretId && !!error}
              initialName={connection?.credentialSecretName}
              initialType={connection?.credentialSecretType as 'LOGIN' | 'SSH_KEY' | undefined}
            />
          ) : (
            <>
              <TextField
                label="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                fullWidth
                required={!isEditMode}
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
            </>
          )}
          <TextField
            label="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            multiline
            rows={2}
          />
          {type === 'RDP' && (
            <FormControlLabel
              control={
                <Checkbox
                  checked={enableDrive}
                  onChange={(e) => setEnableDrive(e.target.checked)}
                />
              }
              label="Enable file sharing (drive redirection)"
            />
          )}
          {type === 'SSH' && (
            <Accordion variant="outlined" disableGutters>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="subtitle2">Terminal Appearance</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <TerminalSettingsSection
                  value={sshTerminalConfig}
                  onChange={setSshTerminalConfig}
                  mode="connection"
                  resolvedDefaults={mergeTerminalConfig(userDefaults)}
                />
              </AccordionDetails>
            </Accordion>
          )}
          {type === 'RDP' && (
            <Accordion variant="outlined" disableGutters>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="subtitle2">RDP Settings</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <RdpSettingsSection
                  value={rdpSettings}
                  onChange={setRdpSettings}
                  mode="connection"
                  resolvedDefaults={mergeRdpConfig(rdpUserDefaults)}
                />
              </AccordionDetails>
            </Accordion>
          )}
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
