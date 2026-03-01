import { useEffect } from 'react';
import { Box } from '@mui/material';
import MainLayout from '../components/Layout/MainLayout';
import { useConnectionsStore } from '../store/connectionsStore';

export default function DashboardPage() {
  const fetchConnections = useConnectionsStore((s) => s.fetchConnections);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <MainLayout />
    </Box>
  );
}
