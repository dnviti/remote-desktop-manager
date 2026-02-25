import { Box, Tab, Tabs, IconButton } from '@mui/material';
import {
  Close as CloseIcon,
  Computer as RdpIcon,
  Terminal as SshIcon,
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
    <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
      <Tabs
        value={activeIndex >= 0 ? activeIndex : 0}
        onChange={(_e, newValue) => {
          if (tabs[newValue]) setActiveTab(tabs[newValue].id);
        }}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ minHeight: 36 }}
      >
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            sx={{ minHeight: 36, textTransform: 'none', py: 0 }}
            icon={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                {tab.connection.type === 'RDP' ? (
                  <RdpIcon sx={{ fontSize: 16 }} />
                ) : (
                  <SshIcon sx={{ fontSize: 16 }} />
                )}
                <span>{tab.connection.name}</span>
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  sx={{ ml: 0.5, p: 0.25 }}
                >
                  <CloseIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Box>
            }
          />
        ))}
      </Tabs>
    </Box>
  );
}
