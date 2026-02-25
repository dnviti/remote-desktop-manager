import { useState } from 'react';
import {
  AppBar, Toolbar, Typography, IconButton, Box, Chip, Menu, MenuItem,
} from '@mui/material';
import {
  Lock as LockIcon,
  LockOpen as LockOpenIcon,
  AccountCircle,
  Add as AddIcon,
} from '@mui/icons-material';
import ConnectionTree from '../Sidebar/ConnectionTree';
import TabBar from '../Tabs/TabBar';
import TabPanel from '../Tabs/TabPanel';
import ConnectionDialog from '../Dialogs/ConnectionDialog';
import VaultUnlockDialog from '../Dialogs/VaultUnlockDialog';
import { useAuthStore } from '../../store/authStore';
import { useVaultStore } from '../../store/vaultStore';
import { logoutApi } from '../../api/auth.api';
import { lockVault } from '../../api/vault.api';
import { ConnectionData } from '../../api/connections.api';

const SIDEBAR_WIDTH = 280;

export default function MainLayout() {
  const user = useAuthStore((s) => s.user);
  const authLogout = useAuthStore((s) => s.logout);
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const vaultUnlocked = useVaultStore((s) => s.unlocked);
  const setVaultUnlocked = useVaultStore((s) => s.setUnlocked);

  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<ConnectionData | null>(null);
  const [vaultDialogOpen, setVaultDialogOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const handleEditConnection = (conn: ConnectionData) => {
    setEditingConnection(conn);
    setConnectionDialogOpen(true);
  };

  const handleLogout = async () => {
    setAnchorEl(null);
    if (refreshToken) {
      try { await logoutApi(refreshToken); } catch {}
    }
    authLogout();
  };

  const handleLockVault = async () => {
    try {
      await lockVault();
      setVaultUnlocked(false);
    } catch {}
  };

  return (
    <>
      <AppBar position="static" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
        <Toolbar variant="dense">
          <Typography variant="h6" sx={{ flexGrow: 0, mr: 2 }}>
            RDM
          </Typography>
          <Chip
            icon={vaultUnlocked ? <LockOpenIcon /> : <LockIcon />}
            label={vaultUnlocked ? 'Vault Unlocked' : 'Vault Locked'}
            color={vaultUnlocked ? 'success' : 'error'}
            size="small"
            onClick={vaultUnlocked ? handleLockVault : () => setVaultDialogOpen(true)}
            sx={{ mr: 2 }}
          />
          <Box sx={{ flexGrow: 1 }} />
          <IconButton
            color="inherit"
            onClick={() => { setEditingConnection(null); setConnectionDialogOpen(true); }}
            title="New connection"
          >
            <AddIcon />
          </IconButton>
          <IconButton
            color="inherit"
            onClick={(e) => setAnchorEl(e.currentTarget)}
          >
            <AccountCircle />
          </IconButton>
          <Menu
            anchorEl={anchorEl}
            open={Boolean(anchorEl)}
            onClose={() => setAnchorEl(null)}
          >
            <MenuItem disabled>
              <Typography variant="body2">{user?.email}</Typography>
            </MenuItem>
            <MenuItem onClick={handleLogout}>Logout</MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar */}
        <Box
          sx={{
            width: SIDEBAR_WIDTH,
            minWidth: SIDEBAR_WIDTH,
            borderRight: 1,
            borderColor: 'divider',
            overflow: 'auto',
            bgcolor: 'background.paper',
          }}
        >
          <ConnectionTree onEditConnection={handleEditConnection} />
        </Box>

        {/* Main content */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <TabBar />
          <TabPanel />
        </Box>
      </Box>

      <ConnectionDialog
        open={connectionDialogOpen}
        onClose={() => { setConnectionDialogOpen(false); setEditingConnection(null); }}
        connection={editingConnection}
      />
      <VaultUnlockDialog
        open={vaultDialogOpen}
        onClose={() => setVaultDialogOpen(false)}
      />
    </>
  );
}
