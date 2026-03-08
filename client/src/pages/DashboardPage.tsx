import { useEffect } from 'react';
import { Box } from '@mui/material';
import MainLayout from '../components/Layout/MainLayout';
import { useConnectionsStore } from '../store/connectionsStore';
import { useTabsStore } from '../store/tabsStore';
import { useAuthStore } from '../store/authStore';

export default function DashboardPage() {
  const fetchConnections = useConnectionsStore((s) => s.fetchConnections);
  const restoreTabs = useTabsStore((s) => s.restoreTabs);
  const fetchDomainProfile = useAuthStore((s) => s.fetchDomainProfile);

  useEffect(() => {
    fetchConnections().then(() => {
      const { ownConnections, sharedConnections, teamConnections } =
        useConnectionsStore.getState();
      restoreTabs([...ownConnections, ...sharedConnections, ...teamConnections]);
    });
    fetchDomainProfile();
  }, [fetchConnections, restoreTabs, fetchDomainProfile]);

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <MainLayout />
    </Box>
  );
}
