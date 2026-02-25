import { useEffect } from 'react';
import { Box } from '@mui/material';
import MainLayout from '../components/Layout/MainLayout';
import { useConnectionsStore } from '../store/connectionsStore';
import { useVaultStore } from '../store/vaultStore';
import api from '../api/client';

export default function DashboardPage() {
  const fetchConnections = useConnectionsStore((s) => s.fetchConnections);
  const setFolders = useConnectionsStore((s) => s.setFolders);
  const checkVaultStatus = useVaultStore((s) => s.checkStatus);

  useEffect(() => {
    checkVaultStatus();
    fetchConnections();
    // Fetch folders
    api.get('/folders').then((res) => setFolders(res.data)).catch(() => {});
  }, []);

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <MainLayout />
    </Box>
  );
}
