import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Box, Alert,
  FormControl, InputLabel, Select, MenuItem, FormControlLabel, Checkbox,
  Accordion, AccordionSummary, AccordionDetails, Typography, Switch, Stack,
} from '@mui/material';
import { ExpandMore as ExpandMoreIcon, Save as SaveIcon } from '@mui/icons-material';
import { useGatewayStore } from '../../store/gatewayStore';
import type { GatewayData } from '../../api/gateway.api';
import SessionTimeoutConfig from '../orchestration/SessionTimeoutConfig';

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
  const [monitoringEnabled, setMonitoringEnabled] = useState(true);
  const [monitorIntervalMs, setMonitorIntervalMs] = useState('5000');
  const [inactivityTimeout, setInactivityTimeout] = useState('60');
  const [autoScaleEnabled, setAutoScaleEnabled] = useState(false);
  const [minReplicasVal, setMinReplicasVal] = useState('0');
  const [maxReplicasVal, setMaxReplicasVal] = useState('5');
  const [sessPerInstance, setSessPerInstance] = useState('10');
  const [cooldownVal, setCooldownVal] = useState('300');
  const [publishPorts, setPublishPorts] = useState(false);
  const [lbStrategy, setLbStrategy] = useState<'ROUND_ROBIN' | 'LEAST_CONNECTIONS'>('ROUND_ROBIN');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [scalingSaving, setScalingSaving] = useState(false);
  const createGateway = useGatewayStore((s) => s.createGateway);
  const updateGateway = useGatewayStore((s) => s.updateGateway);
  const updateScalingConfig = useGatewayStore((s) => s.updateScalingConfig);

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
      setMonitoringEnabled(gateway.monitoringEnabled);
      setMonitorIntervalMs(String(gateway.monitorIntervalMs));
      setInactivityTimeout(String(Math.floor(gateway.inactivityTimeoutSeconds / 60)));
      setAutoScaleEnabled(gateway.autoScale);
      setMinReplicasVal(String(gateway.minReplicas));
      setMaxReplicasVal(String(gateway.maxReplicas));
      setSessPerInstance(String(gateway.sessionsPerInstance));
      setCooldownVal(String(gateway.scaleDownCooldownSeconds));
      setPublishPorts(gateway.publishPorts ?? false);
      setLbStrategy(gateway.lbStrategy ?? 'ROUND_ROBIN');
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
      setMonitoringEnabled(true);
      setMonitorIntervalMs('5000');
      setInactivityTimeout('60');
      setAutoScaleEnabled(false);
      setMinReplicasVal('0');
      setMaxReplicasVal('5');
      setSessPerInstance('10');
      setCooldownVal('300');
      setPublishPorts(false);
      setLbStrategy('ROUND_ROBIN');
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
        if (publishPorts !== (gateway.publishPorts ?? false)) data.publishPorts = publishPorts;
        if ((type === 'MANAGED_SSH' || type === 'GUACD') && lbStrategy !== (gateway.lbStrategy ?? 'ROUND_ROBIN')) data.lbStrategy = lbStrategy;
        if (monitoringEnabled !== gateway.monitoringEnabled) data.monitoringEnabled = monitoringEnabled;
        const intervalNum = parseInt(monitorIntervalMs, 10);
        if (intervalNum && intervalNum !== gateway.monitorIntervalMs) data.monitorIntervalMs = intervalNum;
        const timeoutSec = parseInt(inactivityTimeout, 10) * 60;
        if (timeoutSec && timeoutSec !== gateway.inactivityTimeoutSeconds) data.inactivityTimeoutSeconds = timeoutSec;
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
          monitoringEnabled,
          monitorIntervalMs: parseInt(monitorIntervalMs, 10) || 5000,
          inactivityTimeoutSeconds: (parseInt(inactivityTimeout, 10) || 60) * 60,
          ...(type === 'SSH_BASTION' && username ? { username } : {}),
          ...(type === 'SSH_BASTION' && password ? { password } : {}),
          ...(type === 'SSH_BASTION' && sshPrivateKey ? { sshPrivateKey } : {}),
          ...(type === 'MANAGED_SSH' && apiPortNum ? { apiPort: apiPortNum } : {}),
          ...((type === 'MANAGED_SSH' || type === 'GUACD') && publishPorts ? { publishPorts } : {}),
          ...((type === 'MANAGED_SSH' || type === 'GUACD') ? { lbStrategy } : {}),
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
    setMonitoringEnabled(true);
    setMonitorIntervalMs('5000');
    setInactivityTimeout('60');
    setAutoScaleEnabled(false);
    setMinReplicasVal('0');
    setMaxReplicasVal('5');
    setSessPerInstance('10');
    setCooldownVal('300');
    setPublishPorts(false);
    setLbStrategy('ROUND_ROBIN');
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
              disabled={publishPorts}
              helperText={publishPorts ? 'Auto-assigned at deploy' : 'HTTP port for the key management sidecar (default: 8022)'}
            />
          )}
          {(type === 'MANAGED_SSH' || type === 'GUACD') && (
            <FormControlLabel
              control={
                <Switch
                  checked={publishPorts}
                  onChange={(_, v) => {
                    setPublishPorts(v);
                    if (v) {
                      if (!host) setHost('localhost');
                      const defaultPort = type === 'GUACD' ? '4822' : '2222';
                      setPort(defaultPort);
                    }
                  }}
                  size="small"
                />
              }
              label="Publish Ports (external access)"
            />
          )}
          {publishPorts && (type === 'MANAGED_SSH' || type === 'GUACD') && (
            <Alert severity="info" sx={{ py: 0.5 }}>
              Each deployed instance will get a unique randomly-assigned host port for external access.
            </Alert>
          )}
          {(type === 'MANAGED_SSH' || type === 'GUACD') && (
            <FormControl fullWidth size="small">
              <InputLabel>Load Balancing Strategy</InputLabel>
              <Select
                value={lbStrategy}
                label="Load Balancing Strategy"
                onChange={(e) => setLbStrategy(e.target.value as 'ROUND_ROBIN' | 'LEAST_CONNECTIONS')}
              >
                <MenuItem value="ROUND_ROBIN">Round Robin</MenuItem>
                <MenuItem value="LEAST_CONNECTIONS">Least Connections</MenuItem>
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
              disabled={publishPorts && (type === 'MANAGED_SSH' || type === 'GUACD')}
              helperText={publishPorts && (type === 'MANAGED_SSH' || type === 'GUACD') ? 'Host port auto-assigned at deploy' : undefined}
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
          <FormControlLabel
            control={
              <Checkbox
                checked={monitoringEnabled}
                onChange={(e) => setMonitoringEnabled(e.target.checked)}
              />
            }
            label="Enable health monitoring"
          />
          {monitoringEnabled && (
            <TextField
              label="Monitor interval (ms)"
              value={monitorIntervalMs}
              onChange={(e) => setMonitorIntervalMs(e.target.value)}
              type="number"
              fullWidth
              helperText="How often to check connectivity (1000-3600000ms)"
              inputProps={{ min: 1000, max: 3600000 }}
            />
          )}
          <SessionTimeoutConfig value={inactivityTimeout} onChange={setInactivityTimeout} />

          {/* Auto-Scaling Configuration (edit mode, managed gateway types only) */}
          {isEditMode && gateway?.isManaged && (type === 'MANAGED_SSH' || type === 'GUACD') && (
            <Accordion sx={{ mt: 1 }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="subtitle2">Auto-Scaling Configuration</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={2}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={autoScaleEnabled}
                        onChange={(_, v) => setAutoScaleEnabled(v)}
                        size="small"
                      />
                    }
                    label="Enable Auto-Scale"
                  />
                  {autoScaleEnabled && (
                    <Stack direction="row" spacing={2} flexWrap="wrap">
                      <TextField
                        label="Min Replicas"
                        type="number"
                        size="small"
                        value={minReplicasVal}
                        onChange={(e) => setMinReplicasVal(e.target.value)}
                        inputProps={{ min: 0, max: 20 }}
                        sx={{ width: 120 }}
                      />
                      <TextField
                        label="Max Replicas"
                        type="number"
                        size="small"
                        value={maxReplicasVal}
                        onChange={(e) => setMaxReplicasVal(e.target.value)}
                        inputProps={{ min: 1, max: 20 }}
                        sx={{ width: 120 }}
                      />
                      <TextField
                        label="Sessions/Instance"
                        type="number"
                        size="small"
                        value={sessPerInstance}
                        onChange={(e) => setSessPerInstance(e.target.value)}
                        inputProps={{ min: 1, max: 100 }}
                        sx={{ width: 150 }}
                      />
                      <TextField
                        label="Cooldown (s)"
                        type="number"
                        size="small"
                        value={cooldownVal}
                        onChange={(e) => setCooldownVal(e.target.value)}
                        inputProps={{ min: 60, max: 3600 }}
                        sx={{ width: 120 }}
                      />
                    </Stack>
                  )}
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<SaveIcon />}
                    disabled={scalingSaving}
                    onClick={async () => {
                      setScalingSaving(true);
                      try {
                        await updateScalingConfig(gateway!.id, {
                          autoScale: autoScaleEnabled,
                          minReplicas: Number(minReplicasVal),
                          maxReplicas: Number(maxReplicasVal),
                          sessionsPerInstance: Number(sessPerInstance),
                          scaleDownCooldownSeconds: Number(cooldownVal),
                        });
                      } catch (err) {
                        setError((err as Error).message);
                      } finally {
                        setScalingSaving(false);
                      }
                    }}
                    sx={{ alignSelf: 'flex-start' }}
                  >
                    {scalingSaving ? 'Saving...' : 'Save Scaling Config'}
                  </Button>
                </Stack>
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
