import { Box, Typography } from '@mui/material';
import { useTabsStore } from '../../store/tabsStore';
import SshTerminal from '../Terminal/SshTerminal';
import RdpViewer from '../RDP/RdpViewer';

export default function TabPanel() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);

  if (tabs.length === 0) {
    return (
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'text.secondary',
        }}
      >
        <Typography variant="h6">
          Double-click a connection to open it
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      {tabs.map((tab) => (
        <Box
          key={tab.id}
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: tab.id === activeTabId ? 'flex' : 'none',
          }}
        >
          {tab.connection.type === 'SSH' ? (
            <SshTerminal connectionId={tab.connection.id} tabId={tab.id} />
          ) : (
            <RdpViewer connectionId={tab.connection.id} tabId={tab.id} isActive={tab.id === activeTabId} />
          )}
        </Box>
      ))}
    </Box>
  );
}
