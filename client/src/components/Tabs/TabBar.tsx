import { Box, Tab, Tabs } from '@mui/material';
import {
  Close as CloseIcon,
  Computer as RdpIcon,
  Terminal as SshIcon,
  DesktopWindows as VncIcon,
} from '@mui/icons-material';
import { useTabsStore } from '../../store/tabsStore';

export default function TabBar() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const setActiveTab = useTabsStore((s) => s.setActiveTab);
  const closeTab = useTabsStore((s) => s.closeTab);

  if (tabs.length === 0) return null;

  const activeIndex = tabs.findIndex((t) => t.id === activeTabId);

  return (
    <Box sx={{ borderBottom: '1px solid rgba(35,35,40,0.6)', bgcolor: '#0f0f12' }}>
      <Tabs
        value={activeIndex >= 0 ? activeIndex : 0}
        onChange={(_e, newValue) => {
          if (tabs[newValue]) setActiveTab(tabs[newValue].id);
          // Blur the tab element to prevent MUI Tabs arrow-key navigation
          // from intercepting keyboard input meant for the connection viewer
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
        }}
        variant="scrollable"
        scrollButtons="auto"
        sx={{
          minHeight: 36,
          '& .MuiTabs-indicator': {
            backgroundColor: '#00e5a0',
          },
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
          <Tab
            key={tab.id}
            sx={{
              minHeight: 36,
              textTransform: 'none',
              py: 0,
              color: '#a1a1aa',
              '&.Mui-selected': { color: '#f4f4f5' },
              '&:hover': { bgcolor: 'rgba(0,229,160,0.04)' },
            }}
            icon={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                {tab.connection.type === 'SSH' ? (
                  <SshIcon sx={{ fontSize: 16, color: isActive ? '#00e5a0' : 'inherit' }} />
                ) : tab.connection.type === 'VNC' ? (
                  <VncIcon sx={{ fontSize: 16, color: isActive ? '#00e5a0' : 'inherit' }} />
                ) : (
                  <RdpIcon sx={{ fontSize: 16, color: isActive ? '#00e5a0' : 'inherit' }} />
                )}
                <span>{tab.connection.name}</span>
                <Box
                  component="span"
                  role="button"
                  tabIndex={-1}
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  onMouseDown={(e: React.MouseEvent) => {
                    // Prevent tab from activating when clicking close
                    e.stopPropagation();
                  }}
                  sx={{
                    ml: 0.5,
                    p: 0.25,
                    borderRadius: '50%',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'rgba(0,229,160,0.08)' },
                  }}
                >
                  <CloseIcon sx={{ fontSize: 14 }} />
                </Box>
              </Box>
            }
          />
          );
        })}
      </Tabs>
    </Box>
  );
}
