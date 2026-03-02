import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AppBar, Toolbar, Typography, IconButton, Box, Chip, Menu, MenuItem,
  Snackbar, Alert, Avatar, Button, Badge,
} from '@mui/material';
import {
  Lock as LockIcon,
  LockOpen as LockOpenIcon,
  AccountCircle,
  Settings as SettingsIcon,
  History as HistoryIcon,
  DarkMode,
  LightMode,
  VpnKey as KeychainIcon,
} from '@mui/icons-material';
import ConnectionTree from '../Sidebar/ConnectionTree';
import TabBar from '../Tabs/TabBar';
import TabPanel from '../Tabs/TabPanel';
import ConnectionDialog from '../Dialogs/ConnectionDialog';
import FolderDialog from '../Dialogs/FolderDialog';
import ShareDialog from '../Dialogs/ShareDialog';
import ShareFolderDialog from '../Dialogs/ShareFolderDialog';
import ConnectAsDialog from '../Dialogs/ConnectAsDialog';
import SettingsDialog from '../Dialogs/SettingsDialog';
import AuditLogDialog from '../Dialogs/AuditLogDialog';

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
import { useTabsStore } from '../../store/tabsStore';
import { useGatewayMonitor } from '../../hooks/useGatewayMonitor';
import { useSecretStore } from '../../store/secretStore';

const SIDEBAR_WIDTH = 280;

export default function MainLayout() {
  const navigate = useNavigate();
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

  const expiringCount = useSecretStore((s) => s.expiringCount);
  const fetchExpiringCount = useSecretStore((s) => s.fetchExpiringCount);

  useGatewayMonitor();

  useEffect(() => {
    if (!terminalDefaultsLoaded) {
      fetchTerminalDefaults();
    }
  }, [terminalDefaultsLoaded, fetchTerminalDefaults]);

  useEffect(() => {
    if (vaultUnlocked) {
      fetchExpiringCount();
    }
  }, [vaultUnlocked, fetchExpiringCount]);

  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<ConnectionData | null>(null);
  const [connectionFolderId, setConnectionFolderId] = useState<string | null>(null);
  const [connectionTeamId, setConnectionTeamId] = useState<string | null>(null);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null);
  const [newFolderParentId, setNewFolderParentId] = useState<string | null>(null);
  const [folderTeamId, setFolderTeamId] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState<ConnectionData | null>(null);
  const [shareFolderTarget, setShareFolderTarget] = useState<{ folderId: string; folderName: string } | null>(null);
  const [connectAsTarget, setConnectAsTarget] = useState<ConnectionData | null>(null);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  // Settings & Audit Log modals
  // OAuth link redirect: server redirects to /?linked=google after linking
  const [settingsOpen, setSettingsOpen] = useState(
    () => Boolean(new URLSearchParams(window.location.search).get('linked')),
  );
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | undefined>(
    () => new URLSearchParams(window.location.search).get('linked') ? 'security' : undefined,
  );
  const [auditLogOpen, setAuditLogOpen] = useState(false);
  const [linkedProvider, setLinkedProvider] = useState<string | null>(() => {
    const linked = new URLSearchParams(window.location.search).get('linked');
    if (linked) window.history.replaceState({}, '', '/');
    return linked;
  });

  const handleOpenSettings = (tab?: string) => {
    setSettingsInitialTab(tab);
    setSettingsOpen(true);
  };

  const handleEditConnection = (conn: ConnectionData) => {
    setEditingConnection(conn);
    setConnectionFolderId(null);
    setConnectionDialogOpen(true);
  };

  const handleCreateConnection = (folderId?: string, teamId?: string) => {
    setEditingConnection(null);
    setConnectionFolderId(folderId || null);
    setConnectionTeamId(teamId || null);
    setConnectionDialogOpen(true);
  };

  const handleCreateFolder = (parentId?: string, teamId?: string) => {
    setEditingFolder(null);
    setNewFolderParentId(parentId || null);
    setFolderTeamId(teamId || null);
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

  const handleShareFolder = (folderId: string, folderName: string) => {
    setShareFolderTarget({ folderId, folderName });
  };

  const handleLogout = async () => {
    setAnchorEl(null);
    if (refreshToken) {
      try { await logoutApi(refreshToken); } catch {}
    }
    await useTabsStore.getState().clearAll();
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
            onClick={vaultUnlocked ? handleLockVault : undefined}
            sx={{ mr: 1 }}
          />
          <IconButton
            color="inherit"
            onClick={() => navigate('/keychain')}
            title="Keychain"
            sx={{ mr: 1 }}
          >
            <Badge badgeContent={expiringCount} color="error" max={99}>
              <KeychainIcon />
            </Badge>
          </IconButton>
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
            <MenuItem onClick={() => { setAnchorEl(null); handleOpenSettings(); }}>
              <SettingsIcon fontSize="small" sx={{ mr: 1 }} />
              Settings
            </MenuItem>
            <MenuItem onClick={() => { setAnchorEl(null); setAuditLogOpen(true); }}>
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
          {!user?.tenantId && (
            <Alert
              severity="info"
              variant="outlined"
              sx={{ m: 1, '& .MuiAlert-message': { width: '100%' } }}
              action={
                <Button size="small" onClick={() => handleOpenSettings('organization')}>
                  Get Started
                </Button>
              }
            >
              <Typography variant="body2">
                Set up an organization to create teams and collaborate.
              </Typography>
            </Alert>
          )}
          <ConnectionTree
            onEditConnection={handleEditConnection}
            onShareConnection={handleShareConnection}
            onConnectAsConnection={setConnectAsTarget}
            onCreateConnection={handleCreateConnection}
            onCreateFolder={handleCreateFolder}
            onEditFolder={handleEditFolder}
            onShareFolder={handleShareFolder}
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
        onClose={() => { setConnectionDialogOpen(false); setEditingConnection(null); setConnectionFolderId(null); setConnectionTeamId(null); }}
        connection={editingConnection}
        folderId={connectionFolderId}
        teamId={connectionTeamId}
      />
      <FolderDialog
        open={folderDialogOpen}
        onClose={() => { setFolderDialogOpen(false); setEditingFolder(null); setNewFolderParentId(null); setFolderTeamId(null); }}
        folder={editingFolder}
        parentId={newFolderParentId}
        teamId={folderTeamId}
      />
      <ShareDialog
        open={!!shareTarget}
        onClose={() => setShareTarget(null)}
        connectionId={shareTarget?.id ?? ''}
        connectionName={shareTarget?.name ?? ''}
        teamId={shareTarget?.teamId}
      />
      <ShareFolderDialog
        open={!!shareFolderTarget}
        onClose={() => setShareFolderTarget(null)}
        folderId={shareFolderTarget?.folderId ?? ''}
        folderName={shareFolderTarget?.folderName ?? ''}
      />
      <ConnectAsDialog
        open={!!connectAsTarget}
        onClose={() => setConnectAsTarget(null)}
        connection={connectAsTarget}
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

      <SettingsDialog
        open={settingsOpen}
        onClose={() => { setSettingsOpen(false); setLinkedProvider(null); }}
        initialTab={settingsInitialTab}
        linkedProvider={linkedProvider}
      />
      <AuditLogDialog
        open={auditLogOpen}
        onClose={() => setAuditLogOpen(false)}
      />
    </>
  );
}
