import { useState, useEffect, useCallback } from 'react';
import {
  Card, CardContent, Typography, Switch, FormControlLabel, Alert,
  CircularProgress, Box, TextField, Button, Stack,
} from '@mui/material';
import { useAuthStore } from '../../store/authStore';
import { useNotificationStore } from '../../store/notificationStore';
import { extractApiError } from '../../utils/apiError';
import { getRdGatewayConfig, updateRdGatewayConfig, getRdGatewayStatus } from '../../api/rdGateway.api';
import type { RdGatewayConfig, RdGatewayStatus } from '../../api/rdGateway.api';
import { isAdminOrAbove } from '../../utils/roles';

export default function RdGatewayConfigSection() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = isAdminOrAbove(user?.tenantRole);

  const [config, setConfig] = useState<RdGatewayConfig | null>(null);
  const [status, setStatus] = useState<RdGatewayStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Local form state
  const [enabled, setEnabled] = useState(false);
  const [externalHostname, setExternalHostname] = useState('');
  const [port, setPort] = useState(443);
  const [idleTimeoutSeconds, setIdleTimeoutSeconds] = useState(3600);

  const notify = useNotificationStore((s) => s.notify);

  // Load config and status on mount
  useEffect(() => {
    if (!user?.tenantId || !isAdmin) return;

    Promise.all([
      getRdGatewayConfig().catch(() => null),
      getRdGatewayStatus().catch(() => null),
    ]).then(([cfg, sts]) => {
      if (cfg) {
        setConfig(cfg);
        setEnabled(cfg.enabled);
        setExternalHostname(cfg.externalHostname);
        setPort(cfg.port);
        setIdleTimeoutSeconds(cfg.idleTimeoutSeconds);
      }
      if (sts) setStatus(sts);
      setLoading(false);
    });
  }, [user?.tenantId, isAdmin]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError('');
    try {
      const updated = await updateRdGatewayConfig({
        enabled,
        externalHostname,
        port,
        idleTimeoutSeconds,
      });
      setConfig(updated);
      notify('RD Gateway configuration saved', 'success');
    } catch (err) {
      setError(extractApiError(err, 'Failed to save RD Gateway configuration'));
    } finally {
      setSaving(false);
    }
  }, [enabled, externalHostname, port, idleTimeoutSeconds, notify]);

  if (!isAdmin || !user?.tenantId) return null;

  if (loading) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
            <CircularProgress size={24} />
          </Box>
        </CardContent>
      </Card>
    );
  }

  const hasChanges = config && (
    config.enabled !== enabled ||
    config.externalHostname !== externalHostname ||
    config.port !== port ||
    config.idleTimeoutSeconds !== idleTimeoutSeconds
  );

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
          Native RDP Access (RD Gateway)
        </Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Enable the MS-TSGU RD Gateway protocol so native Windows and macOS RDP clients
          (mstsc.exe, Microsoft Remote Desktop) can tunnel RDP connections through Arsenale.
          Users configure Arsenale as their RD Gateway and connect to authorized targets
          without any client-side agent.
        </Typography>

        {error && <Alert severity="error" sx={{ my: 1 }}>{error}</Alert>}

        <Stack spacing={2} sx={{ mt: 2 }}>
          <FormControlLabel
            control={
              <Switch
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
            }
            label="Enable RD Gateway"
          />

          <TextField
            label="External Hostname"
            value={externalHostname}
            onChange={(e) => setExternalHostname(e.target.value)}
            helperText="The public hostname clients use to reach the RD Gateway (e.g., rdgw.example.com)"
            size="small"
            fullWidth
            disabled={!enabled}
          />

          <TextField
            label="Port"
            type="number"
            value={port}
            onChange={(e) => setPort(parseInt(e.target.value, 10) || 443)}
            helperText="HTTPS port for the RD Gateway endpoint (default: 443)"
            size="small"
            sx={{ maxWidth: 200 }}
            disabled={!enabled}
            inputProps={{ min: 1, max: 65535 }}
          />

          <TextField
            label="Idle Timeout (seconds)"
            type="number"
            value={idleTimeoutSeconds}
            onChange={(e) => setIdleTimeoutSeconds(parseInt(e.target.value, 10) || 3600)}
            helperText="Maximum idle time before tunnel teardown"
            size="small"
            sx={{ maxWidth: 200 }}
            disabled={!enabled}
            inputProps={{ min: 60, max: 86400 }}
          />

          {status && enabled && (
            <Box sx={{ mt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Active tunnels: {status.activeTunnels} | Active channels: {status.activeChannels}
              </Typography>
            </Box>
          )}

          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              variant="contained"
              size="small"
              onClick={handleSave}
              disabled={saving || !hasChanges}
            >
              {saving ? <CircularProgress size={20} /> : 'Save'}
            </Button>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
