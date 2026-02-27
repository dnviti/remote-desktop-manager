import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AppBar, Toolbar, Typography, IconButton, Box, Chip, Menu, MenuItem,
  Snackbar, Alert, Avatar,
} from '@mui/material';
import {
  Lock as LockIcon,
  LockOpen as LockOpenIcon,
  AccountCircle,
  Settings as SettingsIcon,
  History as HistoryIcon,
  DarkMode,
  LightMode,
} from '@mui/icons-material';
import ConnectionTree from '../Sidebar/ConnectionTree';
import TabBar from '../Tabs/TabBar';
import TabPanel from '../Tabs/TabPanel';
import ConnectionDialog from '../Dialogs/ConnectionDialog';
import FolderDialog from '../Dialogs/FolderDialog';
import ShareDialog from '../Dialogs/ShareDialog';
import ConnectAsDialog from '../Dialogs/ConnectAsDialog';
import VaultUnlockDialog from '../Dialogs/VaultUnlockDialog';
import VaultLockedOverlay from '../Overlays/VaultLockedOverlay';
import NotificationBell from './NotificationBell';
import { useAuthStore } from '../../store/authStore';
import { useVaultStore } from '../../store/vaultStore';
import { logoutApi } from '../../api/auth.api';
import { lockVault } from '../../api/vault.api';
import { ConnectionData } from '../../api/connections.api';
import type { Folder } from '../../store/connectionsStore';
import { useNotificationStore } from '../../store/notificationStore';
import { useThemeStore } from '../../store/themeStore';
import { useTerminalSettingsStore } from '../../store/terminalSettingsStore';

const SIDEBAR_WIDTH = 280;

export default function MainLayout() {
  const user = useAuthStore((s) => s.user);
  const authLogout = useAuthStore((s) => s.logout);
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const vaultUnlocked = useVaultStore((s) => s.unlocked);
  const setVaultUnlocked = useVaultStore((s) => s.setUnlocked);
  const vaultInitialized = useVaultStore((s) => s.initialized);
  const vaultLocked = vaultInitialized && !vaultUnlocked;
  const notification = useNotificationStore((s) => s.notification);
  const clearNotification = useNotificationStore((s) => s.clear);
  const themeMode = useThemeStore((s) => s.mode);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const fetchTerminalDefaults = useTerminalSettingsStore((s) => s.fetchDefaults);
  const terminalDefaultsLoaded = useTerminalSettingsStore((s) => s.loaded);

  useEffect(() => {
    if (!terminalDefaultsLoaded) {
      fetchTerminalDefaults();
    }
  }, [terminalDefaultsLoaded, fetchTerminalDefaults]);

  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<ConnectionData | null>(null);
  const [connectionFolderId, setConnectionFolderId] = useState<string | null>(null);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null);
  const [newFolderParentId, setNewFolderParentId] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState<ConnectionData | null>(null);
  const [connectAsTarget, setConnectAsTarget] = useState<ConnectionData | null>(null);
  const [vaultDialogOpen, setVaultDialogOpen] = useState(false);
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const handleEditConnection = (conn: ConnectionData) => {
    setEditingConnection(conn);
    setConnectionFolderId(null);
    setConnectionDialogOpen(true);
  };

  const handleCreateConnection = (folderId?: string) => {
    setEditingConnection(null);
    setConnectionFolderId(folderId || null);
    setConnectionDialogOpen(true);
  };

  const handleCreateFolder = (parentId?: string) => {
    setEditingFolder(null);
    setNewFolderParentId(parentId || null);
    setFolderDialogOpen(true);
  };

  const handleEditFolder = (folder: Folder) => {
    setEditingFolder(folder);
    setNewFolderParentId(null);
    setFolderDialogOpen(true);
  };

  const handleShareConnection = (conn: ConnectionData) => {
    setShareTarget(conn);
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
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          ...(vaultLocked && {
            filter: 'blur(8px)',
            pointerEvents: 'none',
            userSelect: 'none',
          }),
          transition: 'filter 0.3s ease',
        }}
      >
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
          <NotificationBell />
          <IconButton
            color="inherit"
            onClick={toggleTheme}
            title={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {themeMode === 'dark' ? <LightMode /> : <DarkMode />}
          </IconButton>
          <IconButton
            color="inherit"
            onClick={(e) => setAnchorEl(e.currentTarget)}
          >
            {user?.avatarData ? (
              <Avatar src={user.avatarData} sx={{ width: 28, height: 28 }} />
            ) : (
              <AccountCircle />
            )}
          </IconButton>
          <Menu
            anchorEl={anchorEl}
            open={Boolean(anchorEl)}
            onClose={() => setAnchorEl(null)}
          >
            <MenuItem disabled>
              <Typography variant="body2">{user?.username || user?.email}</Typography>
            </MenuItem>
            <MenuItem onClick={() => { setAnchorEl(null); navigate('/settings'); }}>
              <SettingsIcon fontSize="small" sx={{ mr: 1 }} />
              Settings
            </MenuItem>
            <MenuItem onClick={() => { setAnchorEl(null); navigate('/audit-log'); }}>
              <HistoryIcon fontSize="small" sx={{ mr: 1 }} />
              Activity Log
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
          <ConnectionTree
            onEditConnection={handleEditConnection}
            onShareConnection={handleShareConnection}
            onConnectAsConnection={setConnectAsTarget}
            onCreateConnection={handleCreateConnection}
            onCreateFolder={handleCreateFolder}
            onEditFolder={handleEditFolder}
          />
        </Box>

        {/* Main content */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <TabBar />
          <TabPanel />
        </Box>
      </Box>

      <ConnectionDialog
        open={connectionDialogOpen}
        onClose={() => { setConnectionDialogOpen(false); setEditingConnection(null); setConnectionFolderId(null); }}
        connection={editingConnection}
        folderId={connectionFolderId}
      />
      <FolderDialog
        open={folderDialogOpen}
        onClose={() => { setFolderDialogOpen(false); setEditingFolder(null); setNewFolderParentId(null); }}
        folder={editingFolder}
        parentId={newFolderParentId}
      />
      <ShareDialog
        open={!!shareTarget}
        onClose={() => setShareTarget(null)}
        connectionId={shareTarget?.id ?? ''}
        connectionName={shareTarget?.name ?? ''}
      />
      <ConnectAsDialog
        open={!!connectAsTarget}
        onClose={() => setConnectAsTarget(null)}
        connection={connectAsTarget}
      />
      <VaultUnlockDialog
        open={vaultDialogOpen}
        onClose={() => setVaultDialogOpen(false)}
      />

      <Snackbar
        open={notification !== null}
        autoHideDuration={5000}
        onClose={clearNotification}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={clearNotification}
          severity={notification?.severity || 'error'}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {notification?.message}
        </Alert>
      </Snackbar>
      </Box>

      <VaultLockedOverlay />
    </>
  );
}
