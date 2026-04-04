import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  FormControl, InputLabel, Select, MenuItem, Box, Alert,
  FormControlLabel, Checkbox, Accordion, AccordionSummary, AccordionDetails, Typography,
  ToggleButtonGroup, ToggleButton, Switch,
} from '@mui/material';
import { ExpandMore as ExpandMoreIcon, Keyboard, VpnKey, Cloud as CloudIcon } from '@mui/icons-material';
import { createConnection, updateConnection, ConnectionInput, ConnectionUpdate, ConnectionData, DlpPolicy, DbSettings, DbProtocol, OracleConnectionType, OracleRole } from '../../api/connections.api';
import { useConnectionsStore } from '../../store/connectionsStore';
import type { SshTerminalConfig } from '../../constants/terminalThemes';
import { mergeTerminalConfig } from '../../constants/terminalThemes';
import { useTerminalSettingsStore } from '../../store/terminalSettingsStore';
import TerminalSettingsSection from '../Settings/TerminalSettingsSection';
import type { RdpSettings } from '../../constants/rdpDefaults';
import { mergeRdpConfig } from '../../constants/rdpDefaults';
import { useRdpSettingsStore } from '../../store/rdpSettingsStore';
import RdpSettingsSection from '../Settings/RdpSettingsSection';
import type { VncSettings } from '../../constants/vncDefaults';
import { mergeVncConfig } from '../../constants/vncDefaults';
import VncSettingsSection from '../Settings/VncSettingsSection';
import { useGatewayStore } from '../../store/gatewayStore';
import { useAuthStore } from '../../store/authStore';
import { useTenantStore } from '../../store/tenantStore';
import SecretPicker from '../Keychain/SecretPicker';
import { useVaultStore } from '../../store/vaultStore';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';
import { listVaultProviders, VaultProviderData } from '../../api/externalVault.api';
import { gatewayEndpointLabel } from '../../utils/gatewayMode';
import {
  cloudProviderHint,
  nextSSLModeForCloudProvider,
  normalizeCloudProviderSelection,
  remapSSLModeOnProtocolChange,
  supportsCloudProviderPresets,
  tlsModeOptions,
} from '../../utils/dbConnectionSecurity';

interface ConnectionDialogProps {
  open: boolean;
  onClose: () => void;
  connection?: ConnectionData | null;
  folderId?: string | null;
  teamId?: string | null;
}

function supportsPersistedExecutionPlans(protocol?: DbProtocol): boolean {
  return protocol === 'postgresql' || protocol === 'mysql' || protocol === 'oracle' || protocol === 'mssql';
}

function normalizeDbSettings(settings: Partial<DbSettings>): DbSettings | null {
  if (!settings.protocol) {
    return null;
  }

  const supportsCloudPresets = supportsCloudProviderPresets(settings.protocol);

  return {
    ...settings,
    protocol: settings.protocol,
    cloudProvider: supportsCloudPresets ? settings.cloudProvider : undefined,
    sslMode: settings.sslMode,
    persistExecutionPlan: supportsPersistedExecutionPlans(settings.protocol)
      ? settings.persistExecutionPlan
      : undefined,
  };
}

export default function ConnectionDialog({ open, onClose, connection, folderId, teamId }: ConnectionDialogProps) {
  const databaseProxyEnabled = useFeatureFlagsStore((s) => s.databaseProxyEnabled);
  const connectionsEnabled = useFeatureFlagsStore((s) => s.connectionsEnabled);
  const [name, setName] = useState('');
  const [type, setType] = useState<'SSH' | 'RDP' | 'VNC' | 'DATABASE' | 'DB_TUNNEL'>('SSH');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [domain, setDomain] = useState('');
  const [description, setDescription] = useState('');
  const [enableDrive, setEnableDrive] = useState(false);
  const [sshTerminalConfig, setSshTerminalConfig] = useState<Partial<SshTerminalConfig>>({});
  const [rdpSettings, setRdpSettings] = useState<Partial<RdpSettings>>({});
  const [vncSettings, setVncSettings] = useState<Partial<VncSettings>>({});
  const [dbSettings, setDbSettings] = useState<Partial<DbSettings>>({});
  const [gatewayId, setGatewayId] = useState('');
  const [credentialMode, setCredentialMode] = useState<'manual' | 'keychain' | 'external-vault'>('manual');
  const [selectedSecretId, setSelectedSecretId] = useState<string | null>(null);
  const [selectedVaultProviderId, setSelectedVaultProviderId] = useState<string | null>(null);
  const [vaultSecretPath, setVaultSecretPath] = useState('');
  const [vaultProviders, setVaultProviders] = useState<VaultProviderData[]>([]);
  const [defaultConnectMode, setDefaultConnectMode] = useState<string>('');
  const [dlpPolicy, setDlpPolicy] = useState<DlpPolicy>({});
  const [targetDbHost, setTargetDbHost] = useState('');
  const [targetDbPort, setTargetDbPort] = useState('');
  const [dbType, setDbType] = useState('');
  const { loading, error, setError, clearError, run } = useAsyncAction();
  const fetchConnections = useConnectionsStore((s) => s.fetchConnections);
  const userDefaults = useTerminalSettingsStore((s) => s.userDefaults);
  const rdpUserDefaults = useRdpSettingsStore((s) => s.userDefaults);
  const gateways = useGatewayStore((s) => s.gateways);
  const fetchGateways = useGatewayStore((s) => s.fetchGateways);
  const hasTenant = Boolean(useAuthStore((s) => s.user)?.tenantId);
  const tenantEnforced = useTenantStore((s) => s.tenant?.enforcedConnectionSettings);
  const vaultUnlocked = useVaultStore((s) => s.unlocked);

  const isEditMode = Boolean(connection);

  useEffect(() => {
    if (open && hasTenant) {
      fetchGateways();
      listVaultProviders().then(setVaultProviders).catch(() => setVaultProviders([]));
    }
    if (open && connection) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting form state when dialog opens is intentional
      setName(connection.name);
      setType(connection.type);
      setHost(connection.host);
      setPort(String(connection.port));
      setUsername('');
      setPassword('');
      setDomain('');
      setDescription(connection.description || '');
      setEnableDrive(connection.enableDrive ?? false);
      setGatewayId(connection.gatewayId || '');
      setSshTerminalConfig(
        (connection.sshTerminalConfig as Partial<SshTerminalConfig>) ?? {}
      );
      setRdpSettings(
        (connection.rdpSettings as Partial<RdpSettings>) ?? {}
      );
      setVncSettings(
        (connection.vncSettings as Partial<VncSettings>) ?? {}
      );
      setDbSettings(
        (connection.dbSettings as Partial<DbSettings>) ?? {}
      );
      if (connection.externalVaultProviderId) {
        setCredentialMode('external-vault');
        setSelectedVaultProviderId(connection.externalVaultProviderId);
        setVaultSecretPath(connection.externalVaultPath ?? '');
        setSelectedSecretId(null);
      } else if (connection.credentialSecretId) {
        setCredentialMode('keychain');
        setSelectedSecretId(connection.credentialSecretId);
        setSelectedVaultProviderId(null);
        setVaultSecretPath('');
      } else {
        setCredentialMode('manual');
        setSelectedSecretId(null);
        setSelectedVaultProviderId(null);
        setVaultSecretPath('');
      }
      setDefaultConnectMode(connection.defaultCredentialMode ?? '');
      setDlpPolicy((connection.dlpPolicy as DlpPolicy) ?? {});
      setTargetDbHost((connection as ConnectionData & { targetDbHost?: string }).targetDbHost ?? '');
      setTargetDbPort((connection as ConnectionData & { targetDbPort?: number }).targetDbPort?.toString() ?? '');
      setDbType((connection as ConnectionData & { dbType?: string }).dbType ?? '');
    } else if (open && !connection) {
      setName('');
      setType('SSH');
      setHost('');
      setPort('22');
      setUsername('');
      setPassword('');
      setDomain('');
      setDescription('');
      setEnableDrive(false);
      setGatewayId('');
      setSshTerminalConfig({});
      setRdpSettings({});
      setVncSettings({});
      setDbSettings({});
      setCredentialMode('manual');
      setSelectedSecretId(null);
      setSelectedVaultProviderId(null);
      setVaultSecretPath('');
      setDefaultConnectMode('');
      setDlpPolicy({});
      setTargetDbHost('');
      setTargetDbPort('');
      setDbType('');
    }
  }, [open, connection, fetchGateways, hasTenant]);

  const handleTypeChange = (newType: 'SSH' | 'RDP' | 'VNC' | 'DATABASE' | 'DB_TUNNEL') => {
    setType(newType);
    const knownPorts = ['22', '3389', '5900', '5432', '3306', '27017', '1521', '1433', '50000'];
    if (newType === 'SSH' && knownPorts.includes(port)) setPort('22');
    if (newType === 'RDP' && knownPorts.includes(port)) setPort('3389');
    if (newType === 'VNC' && knownPorts.includes(port)) setPort('5900');
    if (newType === 'DATABASE' && knownPorts.includes(port)) setPort('5432');
    if (newType === 'DB_TUNNEL' && knownPorts.includes(port)) setPort('22');
    setGatewayId('');
    if (newType === 'DATABASE') {
      setDbSettings((prev) => ({ protocol: 'postgresql', ...prev }));
    }
  };

  const availableGateways = gateways.filter((g) => {
    if (type === 'SSH' || type === 'DB_TUNNEL') return g.type === 'SSH_BASTION' || g.type === 'MANAGED_SSH';
    if (type === 'RDP' || type === 'VNC') return g.type === 'GUACD';
    if (type === 'DATABASE') return g.type === 'DB_PROXY';
    return false;
  });
  const dbTLSOptions = tlsModeOptions(dbSettings.protocol);
  const currentDbTLSOption = dbTLSOptions.find((option) => option.value === (dbSettings.sslMode ?? ''))
    ?? dbTLSOptions[0];
  const dbCloudHint = cloudProviderHint(dbSettings.protocol, dbSettings.cloudProvider);

  const handleSubmit = async () => {
    if (!name || !host) {
      setError('Name and host are required');
      return;
    }
    if (type === 'DB_TUNNEL' && (!targetDbHost || !targetDbPort)) {
      setError('Target database host and port are required for DB Tunnel connections');
      return;
    }
    if (credentialMode === 'keychain' && !selectedSecretId) {
      setError('Please select a secret from the keychain');
      return;
    }
    if (credentialMode === 'external-vault' && (!selectedVaultProviderId || !vaultSecretPath)) {
      setError('Please select a vault provider and enter a secret path');
      return;
    }
    if (credentialMode === 'manual' && !isEditMode && !username) {
      setError('Username is required for new connections');
      return;
    }

    const ok = await run(async () => {
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
          externalVaultProviderId: credentialMode === 'external-vault' ? selectedVaultProviderId : null,
          externalVaultPath: credentialMode === 'external-vault' ? vaultSecretPath : null,
          ...(type === 'SSH' && {
            sshTerminalConfig: Object.keys(sshTerminalConfig).length > 0 ? sshTerminalConfig : null,
          }),
          ...(type === 'RDP' && {
            rdpSettings: Object.keys(rdpSettings).length > 0 ? rdpSettings : null,
          }),
          ...(type === 'VNC' && {
            vncSettings: Object.keys(vncSettings).length > 0 ? vncSettings : null,
          }),
          ...(type === 'DATABASE' && {
            dbSettings: normalizeDbSettings(dbSettings),
          }),
          defaultCredentialMode: (defaultConnectMode as 'saved' | 'domain' | 'prompt') || null,
          ...((type === 'RDP' || type === 'VNC') && {
            dlpPolicy: Object.values(dlpPolicy).some(Boolean) ? dlpPolicy : null,
          }),
          ...(type === 'DB_TUNNEL' && {
            targetDbHost: targetDbHost || null,
            targetDbPort: targetDbPort ? parseInt(targetDbPort, 10) : null,
            dbType: dbType || null,
          }),
        };
        if (credentialMode === 'manual') {
          if (username) data.username = username;
          if (password) data.password = password;
          if (domain) data.domain = domain;
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
          ...(credentialMode === 'keychain' && selectedSecretId
            ? { credentialSecretId: selectedSecretId }
            : credentialMode === 'external-vault' && selectedVaultProviderId
              ? { externalVaultProviderId: selectedVaultProviderId, externalVaultPath: vaultSecretPath }
              : credentialMode === 'manual' ? { username, password, ...(domain ? { domain } : {}) } : {}),
          ...(folderId ? { folderId } : {}),
          ...(teamId ? { teamId } : {}),
          ...(type === 'SSH' && Object.keys(sshTerminalConfig).length > 0 && {
            sshTerminalConfig,
          }),
          ...(type === 'RDP' && Object.keys(rdpSettings).length > 0 && {
            rdpSettings,
          }),
          ...(type === 'VNC' && Object.keys(vncSettings).length > 0 && {
            vncSettings,
          }),
          ...(type === 'DATABASE' && dbSettings.protocol && {
            dbSettings: normalizeDbSettings(dbSettings) as DbSettings,
          }),
          ...(defaultConnectMode ? { defaultCredentialMode: defaultConnectMode as 'saved' | 'domain' | 'prompt' } : {}),
          ...((type === 'RDP' || type === 'VNC') && Object.values(dlpPolicy).some(Boolean) && {
            dlpPolicy,
          }),
          ...(type === 'DB_TUNNEL' && {
            targetDbHost,
            targetDbPort: parseInt(targetDbPort, 10),
            ...(dbType ? { dbType } : {}),
          }),
        };
        await createConnection(data);
      }
      await fetchConnections();
    }, isEditMode ? 'Failed to update connection' : 'Failed to create connection');
    if (ok) handleClose();
  };

  const handleClose = () => {
    setName('');
    setType('SSH');
    setHost('');
    setPort('22');
    setUsername('');
    setPassword('');
    setDomain('');
    setDescription('');
    setEnableDrive(false);
    setGatewayId('');
    setSshTerminalConfig({});
    setRdpSettings({});
    setVncSettings({});
    setDbSettings({});
    setCredentialMode('manual');
    setSelectedSecretId(null);
    setSelectedVaultProviderId(null);
    setVaultSecretPath('');
    setDefaultConnectMode('');
    setDlpPolicy({});
    setTargetDbHost('');
    setTargetDbPort('');
    setDbType('');
    clearError();
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
              onChange={(e) => handleTypeChange(e.target.value as 'SSH' | 'RDP' | 'VNC' | 'DATABASE' | 'DB_TUNNEL')}
              disabled={isEditMode}
            >
              {connectionsEnabled && <MenuItem value="SSH">SSH</MenuItem>}
              {connectionsEnabled && <MenuItem value="RDP">RDP</MenuItem>}
              {connectionsEnabled && <MenuItem value="VNC">VNC</MenuItem>}
              {databaseProxyEnabled && <MenuItem value="DATABASE">Database</MenuItem>}
              {databaseProxyEnabled && <MenuItem value="DB_TUNNEL">Database (SSH Tunnel)</MenuItem>}
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
                    {gw.name} — {gatewayEndpointLabel(gw)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              label={type === 'DB_TUNNEL' ? 'Bastion Host' : 'Host'}
              value={host}
              onChange={(e) => setHost(e.target.value)}
              fullWidth
              required
            />
            <TextField
              label={type === 'DB_TUNNEL' ? 'Bastion Port' : 'Port'}
              value={port}
              onChange={(e) => setPort(e.target.value)}
              type="number"
              sx={{ width: 120 }}
            />
          </Box>
          {type === 'DB_TUNNEL' && (
            <>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <TextField
                  label="Target DB Host"
                  value={targetDbHost}
                  onChange={(e) => setTargetDbHost(e.target.value)}
                  fullWidth
                  required
                  placeholder="e.g. db.internal.example.com"
                />
                <TextField
                  label="Target DB Port"
                  value={targetDbPort}
                  onChange={(e) => setTargetDbPort(e.target.value)}
                  type="number"
                  sx={{ width: 120 }}
                  required
                  placeholder="5432"
                />
              </Box>
              <FormControl fullWidth>
                <InputLabel>Database Type</InputLabel>
                <Select
                  value={dbType}
                  label="Database Type"
                  onChange={(e) => setDbType(e.target.value)}
                >
                  <MenuItem value="">Generic</MenuItem>
                  <MenuItem value="postgresql">PostgreSQL</MenuItem>
                  <MenuItem value="mysql">MySQL</MenuItem>
                  <MenuItem value="mariadb">MariaDB</MenuItem>
                  <MenuItem value="mongodb">MongoDB</MenuItem>
                  <MenuItem value="redis">Redis</MenuItem>
                  <MenuItem value="mssql">SQL Server</MenuItem>
                  <MenuItem value="oracle">Oracle</MenuItem>
                </Select>
              </FormControl>
            </>
          )}
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Credentials</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box>
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
                  {hasTenant && vaultProviders.length > 0 && (
                    <ToggleButton value="external-vault">
                      <CloudIcon fontSize="small" sx={{ mr: 0.5 }} /> External Vault
                    </ToggleButton>
                  )}
                </ToggleButtonGroup>
              </Box>
              {credentialMode === 'external-vault' ? (
                <>
                  <FormControl fullWidth>
                    <InputLabel>Vault Provider</InputLabel>
                    <Select
                      value={selectedVaultProviderId ?? ''}
                      label="Vault Provider"
                      onChange={(e) => setSelectedVaultProviderId(e.target.value || null)}
                    >
                      {vaultProviders.filter((p) => p.enabled).map((p) => (
                        <MenuItem key={p.id} value={p.id}>
                          {p.name} — {p.serverUrl}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <TextField
                    label="Secret Path"
                    value={vaultSecretPath}
                    onChange={(e) => setVaultSecretPath(e.target.value)}
                    fullWidth
                    required
                    placeholder="e.g. servers/web1"
                    helperText="Path within the KV v2 mount (must contain username/password fields)"
                  />
                </>
              ) : credentialMode === 'keychain' ? (
                <SecretPicker
                  value={selectedSecretId}
                  onChange={(id) => setSelectedSecretId(id)}
                  connectionType={type === 'DB_TUNNEL' ? 'SSH' : type}
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
                  {type === 'RDP' && (
                    <TextField
                      label="Domain (optional)"
                      value={domain}
                      onChange={(e) => setDomain(e.target.value)}
                      fullWidth
                      placeholder={isEditMode ? 'Leave blank to keep unchanged' : 'e.g. CONTOSO'}
                    />
                  )}
                </>
              )}
            </Box>
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="subtitle2">Options</Typography>
              <FormControl fullWidth size="small">
                <InputLabel>Default connect behavior</InputLabel>
                <Select
                  value={defaultConnectMode}
                  label="Default connect behavior"
                  onChange={(e) => setDefaultConnectMode(e.target.value)}
                >
                  <MenuItem value="">Use saved credentials (default)</MenuItem>
                  <MenuItem value="domain">Use domain profile credentials</MenuItem>
                  <MenuItem value="prompt">Always ask (show Connect As dialog)</MenuItem>
                </Select>
              </FormControl>
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
          </Box>
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
                  enforcedFields={tenantEnforced?.ssh}
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
                  enforcedFields={tenantEnforced?.rdp}
                />
              </AccordionDetails>
            </Accordion>
          )}
          {type === 'VNC' && (
            <Accordion variant="outlined" disableGutters>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="subtitle2">VNC Settings</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <VncSettingsSection
                  value={vncSettings}
                  onChange={setVncSettings}
                  mode="connection"
                  resolvedDefaults={mergeVncConfig()}
                  enforcedFields={tenantEnforced?.vnc}
                />
              </AccordionDetails>
            </Accordion>
          )}
          {type === 'DATABASE' && (
            <Accordion variant="outlined" disableGutters defaultExpanded>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="subtitle2">Database Settings</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <FormControl fullWidth>
                    <InputLabel>Database Protocol</InputLabel>
                    <Select
                      value={dbSettings.protocol ?? 'postgresql'}
                      label="Database Protocol"
                      onChange={(e) => {
                        const proto = e.target.value as DbProtocol;
                        setDbSettings((prev) => ({
                          protocol: proto,
                          databaseName: prev.databaseName,
                          cloudProvider: supportsCloudProviderPresets(proto) ? prev.cloudProvider : undefined,
                          sslMode: remapSSLModeOnProtocolChange(
                            prev.protocol,
                            proto,
                            prev.sslMode,
                            supportsCloudProviderPresets(proto) ? prev.cloudProvider : undefined,
                          ),
                          persistExecutionPlan: supportsPersistedExecutionPlans(proto)
                            ? prev.persistExecutionPlan
                            : undefined,
                          ...(proto === 'oracle' ? { oracleConnectionType: 'basic' as OracleConnectionType } : {}),
                        }));
                        const protoPorts: Record<string, string> = { postgresql: '5432', mysql: '3306', mongodb: '27017', oracle: '1521', mssql: '1433', db2: '50000' };
                        setPort(protoPorts[proto] ?? '5432');
                      }}
                    >
                      <MenuItem value="postgresql">PostgreSQL</MenuItem>
                      <MenuItem value="mysql">MySQL / MariaDB</MenuItem>
                      <MenuItem value="mongodb">MongoDB</MenuItem>
                      <MenuItem value="oracle">Oracle (TNS)</MenuItem>
                      <MenuItem value="mssql">Microsoft SQL Server (TDS)</MenuItem>
                      <MenuItem value="db2">IBM DB2 (DRDA)</MenuItem>
                    </Select>
                  </FormControl>
                  <TextField
                    label="Database Name (optional)"
                    value={dbSettings.databaseName ?? ''}
                    onChange={(e) => setDbSettings((prev) => ({ ...prev, databaseName: e.target.value || undefined }))}
                    fullWidth
                    placeholder="e.g. mydb"
                  />
                  {supportsCloudProviderPresets(dbSettings.protocol) && (
                    <>
                      <FormControl fullWidth>
                        <InputLabel>Cloud Provider Preset</InputLabel>
                        <Select
                          value={dbSettings.cloudProvider ?? 'generic'}
                          label="Cloud Provider Preset"
                          onChange={(e) => {
                            const nextProvider = normalizeCloudProviderSelection(e.target.value);
                            setDbSettings((prev) => ({
                              ...prev,
                              cloudProvider: nextProvider,
                              sslMode: nextSSLModeForCloudProvider(
                                prev.protocol,
                                prev.sslMode,
                                prev.cloudProvider,
                                nextProvider,
                              ),
                            }));
                          }}
                        >
                          <MenuItem value="generic">Generic / self-hosted</MenuItem>
                          <MenuItem value="azure">Azure Database</MenuItem>
                          <MenuItem value="aws">AWS RDS / Aurora</MenuItem>
                          <MenuItem value="gcp">GCP Cloud SQL</MenuItem>
                        </Select>
                      </FormControl>
                      <FormControl fullWidth>
                        <InputLabel>TLS Mode</InputLabel>
                        <Select
                          value={dbSettings.sslMode ?? ''}
                          label="TLS Mode"
                          onChange={(e) => setDbSettings((prev) => ({ ...prev, sslMode: e.target.value || undefined }))}
                        >
                          {dbTLSOptions.map((option) => (
                            <MenuItem key={option.value || 'default'} value={option.value}>
                              <Box>
                                <Typography variant="body2">{option.label}</Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {option.helperText}
                                </Typography>
                              </Box>
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      {currentDbTLSOption && (
                        <Typography variant="caption" color="text.secondary">
                          {currentDbTLSOption.helperText}
                        </Typography>
                      )}
                      {dbCloudHint && (
                        <Alert severity="info">
                          {dbCloudHint}
                        </Alert>
                      )}
                      {dbSettings.sslMode === 'skip-verify' && (
                        <Alert severity="warning">
                          Skip verification accepts any server certificate. Use it only when you control the network and cannot trust the certificate chain yet.
                        </Alert>
                      )}
                    </>
                  )}
                  {supportsPersistedExecutionPlans(dbSettings.protocol ?? 'postgresql') && (
                    <Box>
                      <FormControlLabel
                        control={(
                          <Switch
                            checked={Boolean(dbSettings.persistExecutionPlan)}
                            onChange={(e) => setDbSettings((prev) => ({
                              ...prev,
                              persistExecutionPlan: e.target.checked || undefined,
                            }))}
                          />
                        )}
                        label="Persist execution plans in audit logs"
                      />
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: -0.5 }}>
                        Store the DB proxy execution plan with each audited query so it remains visible after the session closes.
                      </Typography>
                    </Box>
                  )}
                  {dbSettings.protocol === 'oracle' && (
                    <>
                      {/* Connection type toggle: Basic | TNS | Custom */}
                      <ToggleButtonGroup
                        value={dbSettings.oracleConnectionType ?? 'basic'}
                        exclusive
                        size="small"
                        onChange={(_e, val) => {
                          if (!val) return;
                          setDbSettings((prev) => ({
                            protocol: 'oracle' as DbProtocol,
                            databaseName: prev.databaseName,
                            persistExecutionPlan: prev.persistExecutionPlan,
                            oracleConnectionType: val as OracleConnectionType,
                            oracleRole: prev.oracleRole,
                            // Keep only fields relevant to the selected mode
                            ...(val === 'basic' ? { oracleSid: prev.oracleSid, oracleServiceName: prev.oracleServiceName } : {}),
                            ...(val === 'tns' ? { oracleTnsAlias: prev.oracleTnsAlias, oracleTnsDescriptor: prev.oracleTnsDescriptor } : {}),
                            ...(val === 'custom' ? { oracleConnectString: prev.oracleConnectString } : {}),
                          }));
                        }}
                        fullWidth
                      >
                        <ToggleButton value="basic">Basic</ToggleButton>
                        <ToggleButton value="tns">TNS</ToggleButton>
                        <ToggleButton value="custom">Custom</ToggleButton>
                      </ToggleButtonGroup>

                      {/* Basic mode */}
                      {(dbSettings.oracleConnectionType ?? 'basic') === 'basic' && (
                        <Box sx={{ display: 'flex', gap: 1.5 }}>
                          <FormControl sx={{ minWidth: 160 }}>
                            <InputLabel>Identifier Type</InputLabel>
                            <Select
                              value={dbSettings.oracleSid ? 'sid' : 'service'}
                              label="Identifier Type"
                              onChange={(e) => {
                                if (e.target.value === 'sid') {
                                  setDbSettings((prev) => ({ ...prev, oracleSid: prev.oracleServiceName || prev.oracleSid || '', oracleServiceName: undefined }));
                                } else {
                                  setDbSettings((prev) => ({ ...prev, oracleServiceName: prev.oracleSid || prev.oracleServiceName || '', oracleSid: undefined }));
                                }
                              }}
                            >
                              <MenuItem value="service">Service Name</MenuItem>
                              <MenuItem value="sid">SID</MenuItem>
                            </Select>
                          </FormControl>
                          <TextField
                            label={dbSettings.oracleSid !== undefined ? 'SID' : 'Service Name'}
                            value={dbSettings.oracleSid ?? dbSettings.oracleServiceName ?? ''}
                            onChange={(e) => {
                              const val = e.target.value || undefined;
                              if (dbSettings.oracleSid !== undefined) {
                                setDbSettings((prev) => ({ ...prev, oracleSid: val }));
                              } else {
                                setDbSettings((prev) => ({ ...prev, oracleServiceName: val }));
                              }
                            }}
                            fullWidth
                            placeholder={dbSettings.oracleSid !== undefined ? 'e.g. ORCL' : 'e.g. FREEPDB1'}
                          />
                        </Box>
                      )}

                      {/* TNS mode */}
                      {dbSettings.oracleConnectionType === 'tns' && (
                        <>
                          <TextField
                            label="TNS Alias"
                            value={dbSettings.oracleTnsAlias ?? ''}
                            onChange={(e) => setDbSettings((prev) => ({ ...prev, oracleTnsAlias: e.target.value || undefined }))}
                            fullWidth
                            placeholder="e.g. MYDB"
                            helperText="Alias from tnsnames.ora (resolved via TNS_ADMIN)"
                          />
                          <TextField
                            label="TNS Descriptor"
                            value={dbSettings.oracleTnsDescriptor ?? ''}
                            onChange={(e) => setDbSettings((prev) => ({ ...prev, oracleTnsDescriptor: e.target.value || undefined }))}
                            fullWidth
                            multiline
                            minRows={2}
                            maxRows={6}
                            placeholder="(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=...)(PORT=...))(CONNECT_DATA=(SERVICE_NAME=...)))"
                            helperText="Full TNS descriptor (overrides alias if both provided)"
                          />
                        </>
                      )}

                      {/* Custom mode */}
                      {dbSettings.oracleConnectionType === 'custom' && (
                        <TextField
                          label="Connect String"
                          value={dbSettings.oracleConnectString ?? ''}
                          onChange={(e) => setDbSettings((prev) => ({ ...prev, oracleConnectString: e.target.value || undefined }))}
                          fullWidth
                          multiline
                          minRows={2}
                          maxRows={6}
                          placeholder="host:port/service_name or full TNS descriptor"
                          helperText="Raw connect string passed directly to the Oracle driver"
                        />
                      )}

                      {/* Oracle Role (all modes) */}
                      <FormControl fullWidth>
                        <InputLabel>Role</InputLabel>
                        <Select
                          value={dbSettings.oracleRole ?? 'normal'}
                          label="Role"
                          onChange={(e) => setDbSettings((prev) => ({ ...prev, oracleRole: (e.target.value === 'normal' ? undefined : e.target.value) as OracleRole | undefined }))}
                        >
                          <MenuItem value="normal">Normal</MenuItem>
                          <MenuItem value="sysdba">SYSDBA</MenuItem>
                          <MenuItem value="sysoper">SYSOPER</MenuItem>
                          <MenuItem value="sysasm">SYSASM</MenuItem>
                          <MenuItem value="sysbackup">SYSBACKUP</MenuItem>
                          <MenuItem value="sysdg">SYSDG</MenuItem>
                          <MenuItem value="syskm">SYSKM</MenuItem>
                          <MenuItem value="sysrac">SYSRAC</MenuItem>
                        </Select>
                      </FormControl>
                    </>
                  )}
                  {dbSettings.protocol === 'mssql' && (
                    <>
                      <TextField
                        label="Instance Name (optional)"
                        value={dbSettings.mssqlInstanceName ?? ''}
                        onChange={(e) => setDbSettings((prev) => ({ ...prev, mssqlInstanceName: e.target.value || undefined }))}
                        fullWidth
                        placeholder="e.g. SQLEXPRESS"
                      />
                      <FormControl fullWidth>
                        <InputLabel>Authentication Mode</InputLabel>
                        <Select
                          value={dbSettings.mssqlAuthMode ?? 'sql'}
                          label="Authentication Mode"
                          onChange={(e) => setDbSettings((prev) => ({ ...prev, mssqlAuthMode: e.target.value as 'sql' | 'windows' }))}
                        >
                          <MenuItem value="sql">SQL Server Authentication</MenuItem>
                          <MenuItem value="windows">Windows Authentication (NTLM/Kerberos)</MenuItem>
                        </Select>
                      </FormControl>
                    </>
                  )}
                  {dbSettings.protocol === 'db2' && (
                    <TextField
                      label="Database Alias (optional)"
                      value={dbSettings.db2DatabaseAlias ?? ''}
                      onChange={(e) => setDbSettings((prev) => ({ ...prev, db2DatabaseAlias: e.target.value || undefined }))}
                      fullWidth
                      placeholder="e.g. SAMPLE"
                      helperText="Alias as cataloged on the DB2 Connect gateway"
                    />
                  )}
                </Box>
              </AccordionDetails>
            </Accordion>
          )}
          {(type === 'RDP' || type === 'VNC') && (
            <Accordion variant="outlined" disableGutters>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="subtitle2">Data Loss Prevention</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                  These restrictions are additive to the organization&apos;s DLP policy.
                </Typography>
                <FormControlLabel
                  control={<Checkbox checked={dlpPolicy.disableCopy ?? false} onChange={(e) => setDlpPolicy((p) => ({ ...p, disableCopy: e.target.checked || undefined }))} />}
                  label="Disable clipboard copy (remote to local)"
                />
                <FormControlLabel
                  control={<Checkbox checked={dlpPolicy.disablePaste ?? false} onChange={(e) => setDlpPolicy((p) => ({ ...p, disablePaste: e.target.checked || undefined }))} />}
                  label="Disable clipboard paste (local to remote)"
                />
                {type === 'RDP' && (
                  <>
                    <FormControlLabel
                      control={<Checkbox checked={dlpPolicy.disableDownload ?? false} onChange={(e) => setDlpPolicy((p) => ({ ...p, disableDownload: e.target.checked || undefined }))} />}
                      label="Disable file download from shared drive"
                    />
                    <FormControlLabel
                      control={<Checkbox checked={dlpPolicy.disableUpload ?? false} onChange={(e) => setDlpPolicy((p) => ({ ...p, disableUpload: e.target.checked || undefined }))} />}
                      label="Disable file upload to shared drive"
                    />
                  </>
                )}
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
