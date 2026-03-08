import { useEffect } from 'react';
import {
  Box, Typography, Button, Tabs, Tab, Accordion, AccordionSummary,
  AccordionDetails, Stack, Chip,
} from '@mui/material';
import { ExpandMore as ExpandMoreIcon } from '@mui/icons-material';
import { useAuthStore } from '../../store/authStore';
import { useGatewayStore } from '../../store/gatewayStore';
import { useUiPreferencesStore } from '../../store/uiPreferencesStore';
import SessionDashboard from './SessionDashboard';
import GatewayInstanceList from './GatewayInstanceList';
import ScalingControls from './ScalingControls';

interface OrchestrationSectionProps {
  onNavigateToTab?: (tabId: string) => void;
}

export default function OrchestrationSection({ onNavigateToTab }: OrchestrationSectionProps) {
  const user = useAuthStore((s) => s.user);
  const gateways = useGatewayStore((s) => s.gateways);
  const fetchGateways = useGatewayStore((s) => s.fetchGateways);

  const subTab = useUiPreferencesStore((s) => s.orchestrationDashboardTab);
  const setSubTab = useUiPreferencesStore((s) => s.set);

  const hasTenant = Boolean(user?.tenantId);

  useEffect(() => {
    if (hasTenant) {
      fetchGateways();
    }
  }, [hasTenant, fetchGateways]);

  if (!hasTenant) {
    return (
      <Box sx={{ textAlign: 'center', py: 6 }}>
        <Typography variant="h6" gutterBottom>No Organization</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          You need to create or join an organization before using orchestration features.
        </Typography>
        <Button variant="contained" onClick={() => onNavigateToTab?.('organization')}>
          Set Up Organization
        </Button>
      </Box>
    );
  }

  const managedGateways = gateways.filter(
    (g) => g.type === 'MANAGED_SSH' || g.type === 'GUACD',
  );

  return (
    <Box>
      <Typography variant="h6" gutterBottom>Orchestration</Typography>

      <Tabs
        value={subTab}
        onChange={(_, v) => setSubTab('orchestrationDashboardTab', v)}
        sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}
      >
        <Tab label="Active Sessions" value="sessions" sx={{ textTransform: 'none' }} />
        <Tab label="Gateway Scaling" value="gateways" sx={{ textTransform: 'none' }} />
      </Tabs>

      {subTab === 'sessions' && <SessionDashboard />}

      {subTab === 'gateways' && (
        <Box>
          {managedGateways.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography color="text.secondary">
                No deployable gateways found. Gateways of type MANAGED_SSH or GUACD can be managed here.
              </Typography>
            </Box>
          ) : (
            managedGateways.map((gw) => (
              <Accordion key={gw.id} defaultExpanded={gw.isManaged}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="subtitle1">{gw.name}</Typography>
                    <Chip label={gw.type} size="small" variant="outlined" />
                    {gw.isManaged && (
                      <Chip label="Managed" size="small" color="primary" />
                    )}
                    {gw.isManaged && (
                      <Typography variant="caption" color="text.secondary">
                        {gw.runningInstances}/{gw.totalInstances} instances
                      </Typography>
                    )}
                  </Stack>
                </AccordionSummary>
                <AccordionDetails>
                  <ScalingControls gatewayId={gw.id} gateway={gw} />
                  {gw.isManaged && gw.totalInstances > 0 && (
                    <Box sx={{ mt: 2 }}>
                      <Typography variant="subtitle2" gutterBottom>Instances</Typography>
                      <GatewayInstanceList gatewayId={gw.id} />
                    </Box>
                  )}
                </AccordionDetails>
              </Accordion>
            ))
          )}
        </Box>
      )}
    </Box>
  );
}
