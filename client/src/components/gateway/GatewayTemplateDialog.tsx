import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Box, Alert,
  FormControl, InputLabel, Select, MenuItem, FormControlLabel, Typography, Switch, Stack,
} from '@mui/material';
import { useGatewayStore } from '../../store/gatewayStore';
import type { GatewayTemplateData } from '../../api/gateway.api';
import SessionTimeoutConfig from '../orchestration/SessionTimeoutConfig';

interface GatewayTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  template?: GatewayTemplateData | null;
}

export default function GatewayTemplateDialog({ open, onClose, template }: GatewayTemplateDialogProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'GUACD' | 'SSH_BASTION' | 'MANAGED_SSH'>('MANAGED_SSH');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [description, setDescription] = useState('');
  const [apiPort, setApiPort] = useState('');
  const [monitoringEnabled, setMonitoringEnabled] = useState(true);
  const [monitorIntervalMs, setMonitorIntervalMs] = useState('5000');
  const [inactivityTimeout, setInactivityTimeout] = useState('60');
  const [autoScaleEnabled, setAutoScaleEnabled] = useState(false);
  const [minReplicasVal, setMinReplicasVal] = useState('1');
  const [maxReplicasVal, setMaxReplicasVal] = useState('5');
  const [sessPerInstance, setSessPerInstance] = useState('10');
  const [cooldownVal, setCooldownVal] = useState('300');
  const [publishPorts, setPublishPorts] = useState(false);
  const [lbStrategy, setLbStrategy] = useState<'ROUND_ROBIN' | 'LEAST_CONNECTIONS'>('ROUND_ROBIN');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const createTemplate = useGatewayStore((s) => s.createTemplate);
  const updateTemplate = useGatewayStore((s) => s.updateTemplate);

  const isEditMode = Boolean(template);

  useEffect(() => {
    if (open && template) {
      setName(template.name);
      setType(template.type);
      setHost(template.host);
      setPort(String(template.port));
      setDescription(template.description || '');
      setApiPort(template.apiPort ? String(template.apiPort) : '');
      setMonitoringEnabled(template.monitoringEnabled);
      setMonitorIntervalMs(String(template.monitorIntervalMs));
      setInactivityTimeout(String(Math.floor(template.inactivityTimeoutSeconds / 60)));
      setAutoScaleEnabled(template.autoScale);
      setMinReplicasVal(String(template.minReplicas));
      setMaxReplicasVal(String(template.maxReplicas));
      setSessPerInstance(String(template.sessionsPerInstance));
      setCooldownVal(String(template.scaleDownCooldownSeconds));
      setPublishPorts(template.publishPorts ?? false);
      setLbStrategy(template.lbStrategy ?? 'ROUND_ROBIN');
    } else if (open) {
      setName('');
      setType('MANAGED_SSH');
      setHost('');
      setPort('22');
      setDescription('');
      setApiPort('8022');
      setMonitoringEnabled(true);
      setMonitorIntervalMs('5000');
      setInactivityTimeout('60');
      setAutoScaleEnabled(false);
      setMinReplicasVal('1');
      setMaxReplicasVal('5');
      setSessPerInstance('10');
      setCooldownVal('300');
      setPublishPorts(false);
      setLbStrategy('ROUND_ROBIN');
    }
    setError('');
  }, [open, template]);

  const handleTypeChange = (newType: 'GUACD' | 'SSH_BASTION' | 'MANAGED_SSH') => {
    setType(newType);
    if (newType === 'SSH_BASTION') {
      if (!port || port === '4822' || port === '2222') setPort('22');
    }
    if (newType === 'MANAGED_SSH' && !apiPort) {
      setApiPort('8022');
    } else if (newType !== 'MANAGED_SSH') {
      setApiPort('');
    }
  };

  const isManagedType = type === 'MANAGED_SSH' || type === 'GUACD';

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (!isManagedType && !host.trim()) {
      setError('Host is required for SSH Bastion gateways');
      return;
    }
    if (!isManagedType && !port.trim()) {
      setError('Port is required for SSH Bastion gateways');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = {
        name: name.trim(),
        type,
        ...(!isManagedType ? { host: host.trim(), port: parseInt(port, 10) } : {}),
        description: description.trim() || undefined,
        apiPort: apiPort ? parseInt(apiPort, 10) : undefined,
        monitoringEnabled,
        monitorIntervalMs: parseInt(monitorIntervalMs, 10),
        inactivityTimeoutSeconds: parseInt(inactivityTimeout, 10) * 60,
        autoScale: autoScaleEnabled,
        minReplicas: parseInt(minReplicasVal, 10),
        maxReplicas: parseInt(maxReplicasVal, 10),
        sessionsPerInstance: parseInt(sessPerInstance, 10),
        scaleDownCooldownSeconds: parseInt(cooldownVal, 10),
        publishPorts,
        lbStrategy,
      };
      if (isEditMode && template) {
        await updateTemplate(template.id, data);
      } else {
        await createTemplate(data);
      }
      onClose();
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        `Failed to ${isEditMode ? 'update' : 'create'} template`
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEditMode ? 'Edit Gateway Template' : 'New Gateway Template'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            label="Template Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            required
          />

          <FormControl fullWidth>
            <InputLabel>Gateway Type</InputLabel>
            <Select
              value={type}
              label="Gateway Type"
              onChange={(e) => handleTypeChange(e.target.value as typeof type)}
            >
              <MenuItem value="GUACD">GUACD (RDP/VNC proxy)</MenuItem>
              <MenuItem value="SSH_BASTION">SSH Bastion</MenuItem>
              <MenuItem value="MANAGED_SSH">Managed SSH</MenuItem>
            </Select>
          </FormControl>

          {isManagedType ? (
            <Alert severity="info" variant="outlined">
              Host and port are automatically assigned by the orchestrator when instances are deployed.
            </Alert>
          ) : (
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
                required
              />
            </Box>
          )}

          {isManagedType && (
            <FormControlLabel
              control={
                <Switch
                  checked={publishPorts}
                  onChange={(_, v) => setPublishPorts(v)}
                  size="small"
                />
              }
              label="Publish Ports (external access)"
            />
          )}

          {isManagedType && (
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

          <TextField
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            fullWidth
            multiline
            minRows={2}
            maxRows={4}
          />

          {type === 'MANAGED_SSH' && (
            <TextField
              label="API Port (for key push)"
              value={apiPort}
              onChange={(e) => setApiPort(e.target.value)}
              type="number"
              fullWidth
              disabled={publishPorts}
              helperText={publishPorts ? 'Auto-assigned at deploy' : undefined}
            />
          )}

          {/* Monitoring */}
          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={monitoringEnabled}
                  onChange={(e) => setMonitoringEnabled(e.target.checked)}
                />
              }
              label="Enable health monitoring"
            />
            {monitoringEnabled && (
              <TextField
                label="Monitor Interval (ms)"
                value={monitorIntervalMs}
                onChange={(e) => setMonitorIntervalMs(e.target.value)}
                type="number"
                fullWidth
                sx={{ mt: 1 }}
              />
            )}
          </Box>

          <SessionTimeoutConfig
            value={inactivityTimeout}
            onChange={setInactivityTimeout}
          />

          {/* Auto-Scaling */}
          <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}>
            <Typography variant="subtitle2" gutterBottom>Auto-Scaling Configuration</Typography>
            <FormControlLabel
              control={
                <Switch
                  checked={autoScaleEnabled}
                  onChange={(e) => setAutoScaleEnabled(e.target.checked)}
                />
              }
              label="Enable auto-scaling"
            />
            {autoScaleEnabled && (
              <Stack spacing={2} sx={{ mt: 1 }}>
                <Box sx={{ display: 'flex', gap: 2 }}>
                  <TextField
                    label="Min Replicas"
                    value={minReplicasVal}
                    onChange={(e) => setMinReplicasVal(e.target.value)}
                    type="number"
                    fullWidth
                  />
                  <TextField
                    label="Max Replicas"
                    value={maxReplicasVal}
                    onChange={(e) => setMaxReplicasVal(e.target.value)}
                    type="number"
                    fullWidth
                  />
                </Box>
                <TextField
                  label="Sessions per Instance"
                  value={sessPerInstance}
                  onChange={(e) => setSessPerInstance(e.target.value)}
                  type="number"
                  fullWidth
                />
                <TextField
                  label="Scale-Down Cooldown (seconds)"
                  value={cooldownVal}
                  onChange={(e) => setCooldownVal(e.target.value)}
                  type="number"
                  fullWidth
                />
              </Stack>
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} variant="contained" disabled={loading}>
          {loading ? 'Saving...' : isEditMode ? 'Update Template' : 'Create Template'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
