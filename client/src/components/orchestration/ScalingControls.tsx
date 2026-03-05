import { useState, useEffect } from 'react';
import {
  Box, Typography, Slider, Button, Switch, FormControlLabel,
  TextField, Stack, Chip, Dialog, DialogTitle, DialogContent,
  DialogContentText, DialogActions, Paper, Alert,
} from '@mui/material';
import {
  RocketLaunch as DeployIcon,
  Delete as UndeployIcon,
  Save as SaveIcon,
} from '@mui/icons-material';
import { useGatewayStore } from '../../store/gatewayStore';
import type { GatewayData } from '../../api/gateway.api';

interface ScalingControlsProps {
  gatewayId: string;
  gateway: GatewayData;
}

const recommendationColor: Record<string, 'success' | 'info' | 'warning'> = {
  stable: 'success',
  'scale-up': 'info',
  'scale-down': 'warning',
};

export default function ScalingControls({ gatewayId, gateway }: ScalingControlsProps) {
  const scalingStatus = useGatewayStore((s) => s.scalingStatus[gatewayId]);
  const fetchScalingStatus = useGatewayStore((s) => s.fetchScalingStatus);
  const deployGatewayAction = useGatewayStore((s) => s.deployGateway);
  const undeployGatewayAction = useGatewayStore((s) => s.undeployGateway);
  const scaleGatewayAction = useGatewayStore((s) => s.scaleGateway);
  const updateScalingConfigAction = useGatewayStore((s) => s.updateScalingConfig);

  const [replicas, setReplicas] = useState(gateway.desiredReplicas);
  const [autoScale, setAutoScale] = useState(gateway.autoScale);
  const [minReplicas, setMinReplicas] = useState(String(gateway.minReplicas));
  const [maxReplicas, setMaxReplicas] = useState(String(gateway.maxReplicas));
  const [sessionsPerInstance, setSessionsPerInstance] = useState(String(gateway.sessionsPerInstance));
  const [cooldown, setCooldown] = useState(String(gateway.scaleDownCooldownSeconds));
  const [undeployOpen, setUndeployOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initial fetch on mount — real-time updates arrive via Socket.IO (scaling:updated)
  useEffect(() => {
    if (gateway.isManaged) {
      fetchScalingStatus(gatewayId);
    }
  }, [gatewayId, gateway.isManaged, fetchScalingStatus]);

  // Sync local form state only when server-side config fields change
  // (not on health probe updates which change lastHealthStatus, lastLatencyMs, etc.)
  useEffect(() => {
    setReplicas(gateway.desiredReplicas);
    setAutoScale(gateway.autoScale);
    setMinReplicas(String(gateway.minReplicas));
    setMaxReplicas(String(gateway.maxReplicas));
    setSessionsPerInstance(String(gateway.sessionsPerInstance));
    setCooldown(String(gateway.scaleDownCooldownSeconds));
  }, [
    gateway.desiredReplicas,
    gateway.autoScale,
    gateway.minReplicas,
    gateway.maxReplicas,
    gateway.sessionsPerInstance,
    gateway.scaleDownCooldownSeconds,
  ]);

  // Keep slider in sync with auto-scaler's target replicas
  useEffect(() => {
    if (scalingStatus && gateway.autoScale) {
      setReplicas(scalingStatus.targetReplicas);
    }
  }, [scalingStatus, gateway.autoScale]);

  const handleDeploy = async () => {
    setLoading(true);
    setError(null);
    try {
      await deployGatewayAction(gatewayId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleUndeploy = async () => {
    setLoading(true);
    setError(null);
    setUndeployOpen(false);
    try {
      await undeployGatewayAction(gatewayId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleScale = async () => {
    setLoading(true);
    setError(null);
    try {
      await scaleGatewayAction(gatewayId, replicas);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveConfig = async () => {
    setLoading(true);
    setError(null);
    try {
      await updateScalingConfigAction(gatewayId, {
        autoScale,
        minReplicas: Number(minReplicas),
        maxReplicas: Number(maxReplicas),
        sessionsPerInstance: Number(sessionsPerInstance),
        scaleDownCooldownSeconds: Number(cooldown),
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ mt: 1 }}>
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Deploy / Undeploy */}
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
        {!gateway.isManaged ? (
          <Button
            variant="contained"
            startIcon={<DeployIcon />}
            onClick={handleDeploy}
            disabled={loading}
            size="small"
          >
            Deploy
          </Button>
        ) : (
          <Button
            variant="outlined"
            color="error"
            startIcon={<UndeployIcon />}
            onClick={() => setUndeployOpen(true)}
            disabled={loading}
            size="small"
          >
            Undeploy All
          </Button>
        )}
      </Stack>

      {/* Replicas slider (only when managed and auto-scale is off) */}
      {gateway.isManaged && !gateway.autoScale && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography variant="subtitle2" gutterBottom>Manual Scaling</Typography>
          <Stack direction="row" spacing={2} alignItems="center">
            <Typography variant="body2" sx={{ minWidth: 60 }}>
              Replicas: {replicas}
            </Typography>
            <Slider
              value={replicas}
              onChange={(_, v) => setReplicas(v as number)}
              min={0}
              max={10}
              step={1}
              marks
              valueLabelDisplay="auto"
              sx={{ flex: 1, maxWidth: 300 }}
            />
            <Button
              variant="outlined"
              size="small"
              onClick={handleScale}
              disabled={loading || replicas === gateway.desiredReplicas}
            >
              Apply
            </Button>
          </Stack>
        </Paper>
      )}

      {/* Auto-Scale config (only when managed) */}
      {gateway.isManaged && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <FormControlLabel
            control={
              <Switch checked={autoScale} onChange={(_, v) => setAutoScale(v)} size="small" />
            }
            label={<Typography variant="subtitle2">Auto-Scale</Typography>}
          />

          {autoScale && (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Stack direction="row" spacing={2} flexWrap="wrap">
                <TextField
                  label="Min Replicas"
                  type="number"
                  size="small"
                  value={minReplicas}
                  onChange={(e) => setMinReplicas(e.target.value)}
                  inputProps={{ min: 0, max: 20 }}
                  sx={{ width: 130 }}
                />
                <TextField
                  label="Max Replicas"
                  type="number"
                  size="small"
                  value={maxReplicas}
                  onChange={(e) => setMaxReplicas(e.target.value)}
                  inputProps={{ min: 1, max: 20 }}
                  sx={{ width: 130 }}
                />
                <TextField
                  label="Sessions/Instance"
                  type="number"
                  size="small"
                  value={sessionsPerInstance}
                  onChange={(e) => setSessionsPerInstance(e.target.value)}
                  inputProps={{ min: 1, max: 100 }}
                  sx={{ width: 160 }}
                />
                <TextField
                  label="Cooldown (s)"
                  type="number"
                  size="small"
                  value={cooldown}
                  onChange={(e) => setCooldown(e.target.value)}
                  inputProps={{ min: 60, max: 3600 }}
                  sx={{ width: 130 }}
                />
              </Stack>
              <Button
                variant="outlined"
                startIcon={<SaveIcon />}
                onClick={handleSaveConfig}
                disabled={loading}
                size="small"
                sx={{ alignSelf: 'flex-start' }}
              >
                Save Scaling Config
              </Button>
            </Stack>
          )}
        </Paper>
      )}

      {/* Scaling status */}
      {scalingStatus && gateway.isManaged && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" gutterBottom>Scaling Status</Typography>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Chip
              label={scalingStatus.recommendation === 'stable' ? 'Stable'
                : scalingStatus.recommendation === 'scale-up' ? 'Scaling Up'
                : 'Scaling Down'}
              size="small"
              color={recommendationColor[scalingStatus.recommendation] ?? 'default'}
            />
            <Typography variant="body2">
              {scalingStatus.activeSessions} sessions across {scalingStatus.currentReplicas} instances
              (target: {scalingStatus.targetReplicas})
            </Typography>
            {scalingStatus.cooldownRemaining > 0 && (
              <Typography variant="caption" color="text.secondary">
                Cooldown: {scalingStatus.cooldownRemaining}s remaining
              </Typography>
            )}
          </Stack>
          {scalingStatus.instanceSessions && scalingStatus.instanceSessions.length > 0 && (
            <Box sx={{ mt: 1 }}>
              <Typography variant="caption" color="text.secondary">
                Per-instance distribution:
              </Typography>
              <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 0.5 }}>
                {scalingStatus.instanceSessions.map((is) => (
                  <Chip
                    key={is.instanceId}
                    label={`${is.containerName.split('-').pop()}: ${is.count}`}
                    size="small"
                    variant="outlined"
                    color={is.count === 0 ? 'default' : 'primary'}
                  />
                ))}
              </Stack>
            </Box>
          )}
        </Paper>
      )}

      {/* Undeploy confirmation */}
      <Dialog open={undeployOpen} onClose={() => setUndeployOpen(false)}>
        <DialogTitle>Undeploy Gateway</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will remove all managed instances for <strong>{gateway.name}</strong>.
            Active sessions through this gateway will be terminated.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUndeployOpen(false)}>Cancel</Button>
          <Button onClick={handleUndeploy} color="error" variant="contained">
            Undeploy
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
