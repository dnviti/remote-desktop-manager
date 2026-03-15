import { useState, useEffect, useCallback, KeyboardEvent } from 'react';
import {
  Card, CardContent, Typography, Switch, FormControlLabel, Alert,
  CircularProgress, Box, TextField, Button, Chip, Stack, Tooltip,
  IconButton,
} from '@mui/material';
import {
  Info as InfoIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { useAuthStore } from '../../store/authStore';
import { useTenantStore } from '../../store/tenantStore';
import { useGatewayStore } from '../../store/gatewayStore';
import { extractApiError } from '../../utils/apiError';

// eslint-disable-next-line security/detect-unsafe-regex
const CIDR_RE = /^(?:(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?|[0-9a-fA-F:]+(?:\/\d{1,3})?)$/;

export default function TunnelConfigSection() {
  const user = useAuthStore((s) => s.user);
  const tenant = useTenantStore((s) => s.tenant);
  const updateTenant = useTenantStore((s) => s.updateTenant);
  const fetchTenant = useTenantStore((s) => s.fetchTenant);

  const tunnelOverview = useGatewayStore((s) => s.tunnelOverview);
  const tunnelOverviewLoading = useGatewayStore((s) => s.tunnelOverviewLoading);
  const fetchTunnelOverview = useGatewayStore((s) => s.fetchTunnelOverview);

  // Local form state
  const [tunnelDefaultEnabled, setTunnelDefaultEnabled] = useState(false);
  const [tunnelRequireForRemote, setTunnelRequireForRemote] = useState(false);
  const [tunnelAutoTokenRotation, setTunnelAutoTokenRotation] = useState(false);
  const [tunnelTokenRotationDays, setTunnelTokenRotationDays] = useState(90);
  const [tunnelTokenMaxLifetimeDays, setTunnelTokenMaxLifetimeDays] = useState<number | null>(null);
  const [tunnelAgentAllowedCidrs, setTunnelAgentAllowedCidrs] = useState<string[]>([]);

  const [newCidr, setNewCidr] = useState('');
  const [cidrError, setCidrError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Sync local state from tenant data
  useEffect(() => {
    if (!tenant) return;
    setTunnelDefaultEnabled(tenant.tunnelDefaultEnabled);
    setTunnelRequireForRemote(tenant.tunnelRequireForRemote);
    setTunnelAutoTokenRotation(tenant.tunnelAutoTokenRotation);
    setTunnelTokenRotationDays(tenant.tunnelTokenRotationDays);
    setTunnelTokenMaxLifetimeDays(tenant.tunnelTokenMaxLifetimeDays);
    setTunnelAgentAllowedCidrs(tenant.tunnelAgentAllowedCidrs);
  }, [tenant]);

  // Fetch tunnel overview on mount
  useEffect(() => {
    if (user?.tenantId) fetchTunnelOverview();
  }, [user?.tenantId, fetchTunnelOverview]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError('');
    setSuccess(false);
    try {
      await updateTenant({
        tunnelDefaultEnabled,
        tunnelRequireForRemote,
        tunnelAutoTokenRotation,
        tunnelTokenRotationDays,
        tunnelTokenMaxLifetimeDays,
        tunnelAgentAllowedCidrs,
      });
      await fetchTenant();
      setSuccess(true);
    } catch (err: unknown) {
      setError(extractApiError(err, 'Failed to save tunnel configuration'));
    } finally {
      setSaving(false);
    }
  }, [
    updateTenant, fetchTenant,
    tunnelDefaultEnabled, tunnelRequireForRemote, tunnelAutoTokenRotation,
    tunnelTokenRotationDays, tunnelTokenMaxLifetimeDays, tunnelAgentAllowedCidrs,
  ]);

  const handleAddCidr = () => {
    const trimmed = newCidr.trim();
    if (!trimmed) return;
    if (!CIDR_RE.test(trimmed)) {
      setCidrError('Invalid IP or CIDR format (e.g. 10.0.0.0/8)');
      return;
    }
    if (tunnelAgentAllowedCidrs.includes(trimmed)) {
      setCidrError('Entry already exists');
      return;
    }
    setTunnelAgentAllowedCidrs((prev) => [...prev, trimmed]);
    setNewCidr('');
    setCidrError('');
  };

  const handleCidrKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddCidr();
    }
  };

  const handleRemoveCidr = (entry: string) => {
    setTunnelAgentAllowedCidrs((prev) => prev.filter((e) => e !== entry));
  };

  if (!tenant) return null;

  return (
    <Stack spacing={2}>
      {/* Tunnel Defaults */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
            Tunnel Defaults
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Configure default tunnel behavior for gateways in this organization.
          </Typography>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {success && <Alert severity="success" sx={{ mb: 2 }}>Settings saved successfully.</Alert>}

          <FormControlLabel
            control={
              <Switch
                checked={tunnelDefaultEnabled}
                onChange={(e) => { setTunnelDefaultEnabled(e.target.checked); setSuccess(false); }}
                disabled={saving}
              />
            }
            label="Enable tunnel by default for new gateways"
          />

          <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={tunnelRequireForRemote}
                  onChange={(e) => { setTunnelRequireForRemote(e.target.checked); setSuccess(false); }}
                  disabled={saving}
                />
              }
              label="Require tunnel for remote gateways"
            />
            <Tooltip title="When enabled, connections to gateways outside the local network must use a zero-trust tunnel. Direct connections will be blocked.">
              <InfoIcon fontSize="small" color="action" sx={{ ml: -1 }} />
            </Tooltip>
          </Box>
        </CardContent>
      </Card>

      {/* Token Security */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
            Token Security
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Control automatic rotation and lifetime of tunnel authentication tokens.
          </Typography>

          <FormControlLabel
            control={
              <Switch
                checked={tunnelAutoTokenRotation}
                onChange={(e) => { setTunnelAutoTokenRotation(e.target.checked); setSuccess(false); }}
                disabled={saving}
              />
            }
            label="Auto-rotate tunnel tokens"
          />

          <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
            <TextField
              size="small"
              type="number"
              label="Rotation interval (days)"
              value={tunnelTokenRotationDays}
              onChange={(e) => { setTunnelTokenRotationDays(Math.max(1, parseInt(e.target.value, 10) || 1)); setSuccess(false); }}
              disabled={saving || !tunnelAutoTokenRotation}
              slotProps={{ htmlInput: { min: 1, max: 3650 } }}
              sx={{ width: 200 }}
            />
            <TextField
              size="small"
              type="number"
              label="Max token lifetime (days)"
              value={tunnelTokenMaxLifetimeDays ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                setTunnelTokenMaxLifetimeDays(val === '' ? null : Math.max(1, parseInt(val, 10) || 1));
                setSuccess(false);
              }}
              disabled={saving}
              slotProps={{ htmlInput: { min: 1, max: 3650 } }}
              helperText="Leave empty for no limit"
              sx={{ width: 220 }}
            />
          </Box>
        </CardContent>
      </Card>

      {/* Agent Restrictions */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
            Agent Restrictions
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Restrict which IP addresses tunnel agents can connect from.
          </Typography>

          <Box sx={{ display: 'flex', gap: 1, mb: 1, mt: 1 }}>
            <TextField
              size="small"
              placeholder="e.g. 10.0.0.0/8 or 192.168.1.0/24"
              value={newCidr}
              onChange={(e) => { setNewCidr(e.target.value); setCidrError(''); }}
              onKeyDown={handleCidrKeyDown}
              error={!!cidrError}
              helperText={cidrError || 'Leave empty to allow all IPs'}
              disabled={saving}
              sx={{ flex: 1 }}
            />
            <Button variant="outlined" size="small" onClick={handleAddCidr} disabled={saving || !newCidr.trim()}>
              Add
            </Button>
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, minHeight: 32 }}>
            {tunnelAgentAllowedCidrs.length === 0 && (
              <Typography variant="caption" color="text.secondary">
                No restrictions — agents can connect from any IP
              </Typography>
            )}
            {tunnelAgentAllowedCidrs.map((entry) => (
              <Chip
                key={entry}
                label={entry}
                size="small"
                variant="outlined"
                onDelete={() => handleRemoveCidr(entry)}
                disabled={saving}
              />
            ))}
          </Box>
        </CardContent>
      </Card>

      {/* Fleet Overview */}
      <Card variant="outlined">
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="subtitle1" fontWeight="bold">
              Fleet Overview
            </Typography>
            <Tooltip title="Refresh">
              <IconButton size="small" onClick={fetchTunnelOverview} disabled={tunnelOverviewLoading}>
                <RefreshIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
          {tunnelOverviewLoading && !tunnelOverview ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <CircularProgress size={24} />
            </Box>
          ) : tunnelOverview ? (
            <Stack spacing={1}>
              <Typography variant="body2">
                <strong>{tunnelOverview.total}</strong> tunneled gateway{tunnelOverview.total !== 1 ? 's' : ''}:{' '}
                <Typography component="span" variant="body2" color="success.main">
                  {tunnelOverview.connected} connected
                </Typography>
                {', '}
                <Typography component="span" variant="body2" color={tunnelOverview.disconnected > 0 ? 'error.main' : 'text.secondary'}>
                  {tunnelOverview.disconnected} disconnected
                </Typography>
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Average RTT: {tunnelOverview.avgRttMs != null ? `${tunnelOverview.avgRttMs} ms` : 'N/A'}
              </Typography>
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No tunnel data available.
            </Typography>
          )}
        </CardContent>
      </Card>

      {/* Save button */}
      <Box>
        <Button variant="contained" size="small" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </Box>
    </Stack>
  );
}
