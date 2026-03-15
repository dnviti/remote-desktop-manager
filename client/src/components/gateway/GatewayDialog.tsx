import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Box, Alert,
  FormControl, InputLabel, Select, MenuItem, FormControlLabel, Checkbox,
  Accordion, AccordionSummary, AccordionDetails, Typography, Switch, Stack,
  Chip, CircularProgress, Divider,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon, Save as SaveIcon,
  VpnLock as TunnelIcon, ContentCopy as CopyIcon,
  Refresh as RotateIcon, Delete as RevokeIcon,
} from '@mui/icons-material';
import { useGatewayStore } from '../../store/gatewayStore';
import { useUiPreferencesStore } from '../../store/uiPreferencesStore';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import type { GatewayData } from '../../api/gateway.api';
import SessionTimeoutConfig from '../orchestration/SessionTimeoutConfig';
import { useAsyncAction } from '../../hooks/useAsyncAction';

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

  // Tunnel state
  const [tunnelToken, setTunnelToken] = useState<string | null>(null);
  const [tunnelDeploying, setTunnelDeploying] = useState(false);
  const [tunnelError, setTunnelError] = useState('');
  const [rotateConfirmOpen, setRotateConfirmOpen] = useState(false);
  const [revokeConfirmOpen, setRevokeConfirmOpen] = useState(false);

  const { loading, error, setError, run } = useAsyncAction();
  const { loading: scalingSaving, run: runScaling } = useAsyncAction();
  const { loading: tunnelActionLoading, run: runTunnelAction } = useAsyncAction();

  const createGateway = useGatewayStore((s) => s.createGateway);
  const updateGateway = useGatewayStore((s) => s.updateGateway);
  const updateScalingConfig = useGatewayStore((s) => s.updateScalingConfig);
  const generateTunnelTokenAction = useGatewayStore((s) => s.generateTunnelToken);
  const revokeTunnelTokenAction = useGatewayStore((s) => s.revokeTunnelToken);

  const tunnelSectionOpen = useUiPreferencesStore((s) => s.tunnelSectionOpen);
  const setUiPref = useUiPreferencesStore((s) => s.set);

  const { copied: tokenCopied, copy: copyToken } = useCopyToClipboard();
  const { copied: cmdCopied, copy: copyCmd } = useCopyToClipboard();

  const isEditMode = Boolean(gateway);
  const isTunnelEnabled = gateway?.tunnelEnabled ?? false;
  const isTunnelConnected = gateway?.tunnelConnected ?? false;

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
    setTunnelToken(null);
    setTunnelError('');
    setTunnelDeploying(false);
    setRotateConfirmOpen(false);
    setRevokeConfirmOpen(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

    const ok = await run(async () => {
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
    }, isEditMode ? 'Failed to update gateway' : 'Failed to create gateway');
    if (ok) handleClose();
  };

  const handleEnableTunnel = async () => {
    if (!gateway) return;
    setTunnelError('');
    setTunnelDeploying(true);
    const ok = await runTunnelAction(async () => {
      const result = await generateTunnelTokenAction(gateway.id);
      setTunnelToken(result.token);
    }, 'Failed to enable tunnel');
    setTunnelDeploying(false);
    if (!ok) setTunnelError('Failed to generate tunnel token');
  };

  const handleRotateTunnel = async () => {
    if (!gateway) return;
    setRotateConfirmOpen(false);
    setTunnelError('');
    const ok = await runTunnelAction(async () => {
      const result = await generateTunnelTokenAction(gateway.id);
      setTunnelToken(result.token);
    }, 'Failed to rotate tunnel token');
    if (!ok) setTunnelError('Failed to rotate tunnel token');
  };

  const handleRevokeTunnel = async () => {
    if (!gateway) return;
    setRevokeConfirmOpen(false);
    setTunnelError('');
    const ok = await runTunnelAction(async () => {
      await revokeTunnelTokenAction(gateway.id);
      setTunnelToken(null);
    }, 'Failed to revoke tunnel token');
    if (!ok) setTunnelError('Failed to revoke tunnel token');
  };

  const buildConnectionString = (token: string): string => {
    const serverUrl = window.location.origin;
    const payload = { serverUrl, tunnelToken: token, gatewayId: gateway?.id ?? '' };
    return btoa(JSON.stringify(payload));
  };

  const buildDockerCommand = (token: string): string => {
    const connStr = buildConnectionString(token);
    return `docker run -d --restart=unless-stopped \\\n  -e ARSENALE_CONNECTION="${connStr}" \\\n  arsenale/tunnel-agent:latest`;
  };

  const certExpDisplay = (): string | null => {
    if (!gateway?.tunnelClientCertExp) return null;
    const exp = new Date(gateway.tunnelClientCertExp);
    const now = new Date();
    const diffDays = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const expStr = exp.toLocaleDateString();
    if (diffDays <= 0) return `Expired on ${expStr}`;
    if (diffDays <= 7) return `Expires ${expStr} — renewal imminent`;
    return `Expires ${expStr} (next renewal in ${diffDays} days)`;
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
    setTunnelToken(null);
    setTunnelError('');
    setTunnelDeploying(false);
    setRotateConfirmOpen(false);
    setRevokeConfirmOpen(false);
    onClose();
  };

  // Render tunnel status chip
  const renderTunnelStatusChip = () => {
    if (!isTunnelEnabled) return null;
    if (tunnelDeploying || tunnelActionLoading) {
      return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CircularProgress size={14} />
          <Typography variant="caption" color="text.secondary">Deploying...</Typography>
        </Box>
      );
    }
    return isTunnelConnected
      ? <Chip label="Connected" size="small" color="success" />
      : <Chip label="Disconnected" size="small" color="error" />;
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
              slotProps={{ input: { readOnly: isTunnelEnabled && isEditMode } }}
              helperText={isTunnelEnabled && isEditMode ? 'Managed by tunnel' : undefined}
            />
            <TextField
              label="Port"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              type="number"
              sx={{ width: 120 }}
              disabled={(publishPorts && (type === 'MANAGED_SSH' || type === 'GUACD')) || (isTunnelEnabled && isEditMode)}
              helperText={
                isTunnelEnabled && isEditMode ? 'Tunnel' :
                publishPorts && (type === 'MANAGED_SSH' || type === 'GUACD') ? 'Host port auto-assigned at deploy' :
                undefined
              }
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
                    onClick={() => runScaling(async () => {
                      await updateScalingConfig(gateway?.id ?? '', {
                        autoScale: autoScaleEnabled,
                        minReplicas: Number(minReplicasVal),
                        maxReplicas: Number(maxReplicasVal),
                        sessionsPerInstance: Number(sessPerInstance),
                        scaleDownCooldownSeconds: Number(cooldownVal),
                      });
                    }, 'Failed to save scaling config')}
                    sx={{ alignSelf: 'flex-start' }}
                  >
                    {scalingSaving ? 'Saving...' : 'Save Scaling Config'}
                  </Button>
                </Stack>
              </AccordionDetails>
            </Accordion>
          )}

          {/* Zero-Trust Tunnel Section (edit mode only) */}
          {isEditMode && (
            <Accordion
              expanded={tunnelSectionOpen}
              onChange={(_, expanded) => setUiPref('tunnelSectionOpen', expanded)}
              sx={{ mt: 1 }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                  <TunnelIcon fontSize="small" color={isTunnelEnabled ? 'primary' : 'disabled'} />
                  <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>Zero-Trust Tunnel</Typography>
                  {renderTunnelStatusChip()}
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={2}>
                  {tunnelError && (
                    <Alert severity="error" onClose={() => setTunnelError('')}>{tunnelError}</Alert>
                  )}

                  {!isTunnelEnabled ? (
                    <>
                      <Typography variant="body2" color="text.secondary">
                        Enable a zero-trust tunnel so the gateway agent connects outbound to this server.
                        No inbound ports required.
                      </Typography>
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={tunnelDeploying || tunnelActionLoading ? <CircularProgress size={14} /> : <TunnelIcon />}
                        disabled={tunnelDeploying || tunnelActionLoading}
                        onClick={handleEnableTunnel}
                        sx={{ alignSelf: 'flex-start' }}
                      >
                        {tunnelDeploying || tunnelActionLoading ? 'Enabling...' : 'Enable Zero-Trust Tunnel'}
                      </Button>
                    </>
                  ) : (
                    <>
                      {/* Status row */}
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" color="text.secondary">Status:</Typography>
                        {renderTunnelStatusChip()}
                        {gateway?.tunnelConnectedAt && isTunnelConnected && (
                          <Typography variant="caption" color="text.secondary">
                            since {new Date(gateway.tunnelConnectedAt).toLocaleString()}
                          </Typography>
                        )}
                      </Box>

                      {/* Cert expiry */}
                      {certExpDisplay() && (
                        <Alert severity="info" sx={{ py: 0.5 }}>
                          {certExpDisplay()}
                        </Alert>
                      )}

                      <Divider />

                      {/* Managed gateway: show newly generated token once */}
                      {gateway?.isManaged && tunnelToken && (
                        <Alert severity="warning">
                          Token generated — copy it now, it will not be shown again.
                          <Box sx={{ mt: 1 }}>
                            <TextField
                              value={tunnelToken}
                              size="small"
                              fullWidth
                              slotProps={{ input: { readOnly: true, style: { fontFamily: 'monospace', fontSize: '0.75rem' } } }}
                            />
                            <Button
                              size="small"
                              startIcon={<CopyIcon />}
                              onClick={() => copyToken(tunnelToken)}
                              sx={{ mt: 0.5 }}
                            >
                              {tokenCopied ? 'Copied!' : 'Copy Token'}
                            </Button>
                          </Box>
                        </Alert>
                      )}

                      {/* Non-managed gateway: show docker run command */}
                      {!gateway?.isManaged && (
                        <>
                          <Typography variant="body2" color="text.secondary">
                            Run the following Docker command on the gateway machine:
                          </Typography>
                          {tunnelToken ? (
                            <>
                              <TextField
                                value={buildDockerCommand(tunnelToken)}
                                multiline
                                minRows={3}
                                size="small"
                                fullWidth
                                slotProps={{ input: { readOnly: true, style: { fontFamily: 'monospace', fontSize: '0.75rem' } } }}
                              />
                              <Button
                                size="small"
                                startIcon={<CopyIcon />}
                                onClick={() => copyCmd(buildDockerCommand(tunnelToken))}
                              >
                                {cmdCopied ? 'Copied!' : 'Copy Docker Command'}
                              </Button>
                              <Alert severity="warning" sx={{ py: 0.5 }}>
                                Copy this command now — the token will not be shown again after closing.
                              </Alert>
                            </>
                          ) : (
                            <Alert severity="info" sx={{ py: 0.5 }}>
                              Tunnel is enabled. Rotate the token to get a new docker run command.
                            </Alert>
                          )}
                        </>
                      )}

                      {/* Token management buttons */}
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        {!rotateConfirmOpen ? (
                          <Button
                            size="small"
                            variant="outlined"
                            color="warning"
                            startIcon={<RotateIcon />}
                            disabled={tunnelActionLoading}
                            onClick={() => setRotateConfirmOpen(true)}
                          >
                            Rotate Token
                          </Button>
                        ) : (
                          <>
                            <Typography variant="caption" color="warning.main" sx={{ alignSelf: 'center' }}>
                              Confirm rotate?
                            </Typography>
                            <Button size="small" color="warning" variant="contained" onClick={handleRotateTunnel} disabled={tunnelActionLoading}>
                              Yes, Rotate
                            </Button>
                            <Button size="small" onClick={() => setRotateConfirmOpen(false)}>Cancel</Button>
                          </>
                        )}

                        {!revokeConfirmOpen ? (
                          <Button
                            size="small"
                            variant="outlined"
                            color="error"
                            startIcon={<RevokeIcon />}
                            disabled={tunnelActionLoading}
                            onClick={() => setRevokeConfirmOpen(true)}
                          >
                            Revoke Token
                          </Button>
                        ) : (
                          <>
                            <Typography variant="caption" color="error.main" sx={{ alignSelf: 'center' }}>
                              Confirm revoke?
                            </Typography>
                            <Button size="small" color="error" variant="contained" onClick={handleRevokeTunnel} disabled={tunnelActionLoading}>
                              Yes, Revoke
                            </Button>
                            <Button size="small" onClick={() => setRevokeConfirmOpen(false)}>Cancel</Button>
                          </>
                        )}
                      </Box>
                    </>
                  )}
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
