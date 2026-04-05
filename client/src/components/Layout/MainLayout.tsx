import { useState, useEffect, lazy, Suspense } from 'react';
import {
  AppBar, Toolbar, Typography, IconButton, Box, Chip, Menu, MenuItem,
  Snackbar, Alert, Avatar, Button, Badge,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Lock as LockIcon,
  LockOpen as LockOpenIcon,
  AccountCircle,
  Settings as SettingsIcon,
  History as HistoryIcon,
  DarkMode,
  LightMode,
  VpnKey as KeychainIcon,
  Videocam as VideocamIcon,
  AccessTime as CheckoutIcon,
} from '@mui/icons-material';
import ConnectionTree from '../Sidebar/ConnectionTree';
import TabBar from '../Tabs/TabBar';
import TabPanel from '../Tabs/TabPanel';
const ConnectionDialog = lazy(() => import('../Dialogs/ConnectionDialog'));
const FolderDialog = lazy(() => import('../Dialogs/FolderDialog'));
const ShareDialog = lazy(() => import('../Dialogs/ShareDialog'));
const ShareFolderDialog = lazy(() => import('../Dialogs/ShareFolderDialog'));
const ConnectAsDialog = lazy(() => import('../Dialogs/ConnectAsDialog'));
const SettingsDialog = lazy(() => import('../Dialogs/SettingsDialog'));
const AuditLogDialog = lazy(() => import('../Dialogs/AuditLogDialog'));
const KeychainDialog = lazy(() => import('../Dialogs/KeychainDialog'));
const ConnectionAuditLogDialog = lazy(() => import('../Dialogs/ConnectionAuditLogDialog'));
const UserProfileDialog = lazy(() => import('../Dialogs/UserProfileDialog'));
const RecordingsDialog = lazy(() => import('../Recording/RecordingsDialog'));
const ExportDialog = lazy(() => import('../Dialogs/ExportDialog'));
const ImportDialog = lazy(() => import('../Dialogs/ImportDialog'));
const GeoIpDialog = lazy(() => import('../Audit/GeoIpDialog'));
const CheckoutDialog = lazy(() => import('../Dialogs/CheckoutDialog'));

import TenantSwitcher from './TenantSwitcher';
import NotificationBell from './NotificationBell';
import VersionIndicator from './VersionIndicator';
import { useAuthStore } from '../../store/authStore';
import { useVaultStore } from '../../store/vaultStore';
import { logoutApi } from '../../api/auth.api';
import { lockVault } from '../../api/vault.api';
import { ConnectionData } from '../../api/connections.api';
import { useConnectionsStore, type Folder } from '../../store/connectionsStore';
import { useNotificationStore } from '../../store/notificationStore';
import { useThemeStore } from '../../store/themeStore';
import { useTerminalSettingsStore } from '../../store/terminalSettingsStore';
import { useTabsStore } from '../../store/tabsStore';
import { useGatewayMonitor } from '../../hooks/useGatewayMonitor';
import { useShareSync } from '../../hooks/useShareSync';
import { useSecretStore } from '../../store/secretStore';
import { useLazyMount } from '../../hooks/useLazyMount';
import { useDlpBrowserHardening } from '../../hooks/useDlpBrowserHardening';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';
import type { NavigationActions } from '../../utils/notificationActions';

const SIDEBAR_WIDTH = 280;

export default function MainLayout() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const authLogout = useAuthStore((s) => s.logout);
  const fetchCurrentPermissions = useAuthStore((s) => s.fetchCurrentPermissions);
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
  const pwnedCount = useSecretStore((s) => s.pwnedCount);
  const fetchCounts = useSecretStore((s) => s.fetchCounts);

  const connectionsEnabled = useFeatureFlagsStore((s) => s.connectionsEnabled);
  const databaseProxyEnabled = useFeatureFlagsStore((s) => s.databaseProxyEnabled);
  const ipGeolocationEnabled = useFeatureFlagsStore((s) => s.ipGeolocationEnabled);
  const keychainEnabled = useFeatureFlagsStore((s) => s.keychainEnabled);
  const multiTenancyEnabled = useFeatureFlagsStore((s) => s.multiTenancyEnabled);
  const featureFlagsLoaded = useFeatureFlagsStore((s) => s.loaded);
  const recordingsEnabled = useFeatureFlagsStore((s) => s.recordingsEnabled);
  const sharingApprovalsEnabled = useFeatureFlagsStore((s) => s.sharingApprovalsEnabled);
  const fetchFeatureFlags = useFeatureFlagsStore((s) => s.fetchFeatureFlags);
  const checkVaultStatus = useVaultStore((s) => s.checkStatus);
  const anyConnectionFeature = connectionsEnabled || databaseProxyEnabled;

  useGatewayMonitor();
  useShareSync();
  useDlpBrowserHardening();

  // Suppress native browser context menu globally to enforce DLP controls (CTX-301)
  useEffect(() => {
    const prevent = (e: MouseEvent) => e.preventDefault();
    document.addEventListener('contextmenu', prevent, { capture: true });
    return () => document.removeEventListener('contextmenu', prevent, { capture: true });
  }, []);

  useEffect(() => {
    if (!terminalDefaultsLoaded) {
      fetchTerminalDefaults();
    }
  }, [terminalDefaultsLoaded, fetchTerminalDefaults]);

  useEffect(() => {
    if (!accessToken) {
      return;
    }
    void fetchCurrentPermissions();
  }, [accessToken, user?.id, user?.tenantId, fetchCurrentPermissions]);

  useEffect(() => {
    if (vaultUnlocked) {
      fetchCounts();
    }
  }, [vaultUnlocked, fetchCounts]);

  useEffect(() => {
    if (!featureFlagsLoaded || !keychainEnabled) {
      return;
    }
    void checkVaultStatus();
  }, [checkVaultStatus, featureFlagsLoaded, keychainEnabled]);

  // PWA app shortcut deep-link: read ?action= query param to pre-open a dialog on mount (PWA-003)
  const [pwaAction] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    if (action) window.history.replaceState({}, '', '/');
    return action;
  });

  const [connectionDialogOpen, setConnectionDialogOpen] = useState(() => pwaAction === 'new-connection');
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
    () => pwaAction === 'open-settings' || Boolean(new URLSearchParams(window.location.search).get('linked')),
  );
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | undefined>(
    () => new URLSearchParams(window.location.search).get('linked') ? 'security' : undefined,
  );
  const [auditLogOpen, setAuditLogOpen] = useState(false);
  const [keychainOpen, setKeychainOpen] = useState(() => pwaAction === 'open-keychain');
  const [recordingsOpen, setRecordingsOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [connectionAuditTarget, setConnectionAuditTarget] = useState<{ id: string; name: string } | null>(null);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [geoIpTarget, setGeoIpTarget] = useState<string | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [linkedProvider, setLinkedProvider] = useState<string | null>(() => {
    const linked = new URLSearchParams(window.location.search).get('linked');
    if (linked) window.history.replaceState({}, '', '/');
    return linked;
  });

  // Lazy-mount guards: keep Suspense wrapper mounted after first open to preserve close animations
  const connectionDialogMounted = useLazyMount(connectionDialogOpen);
  const folderDialogMounted = useLazyMount(folderDialogOpen);
  const shareDialogMounted = useLazyMount(shareTarget);
  const shareFolderDialogMounted = useLazyMount(shareFolderTarget);
  const connectAsDialogMounted = useLazyMount(connectAsTarget);
  const settingsDialogMounted = useLazyMount(settingsOpen);
  const auditLogDialogMounted = useLazyMount(auditLogOpen);
  const keychainDialogMounted = useLazyMount(keychainOpen);
  const connectionAuditDialogMounted = useLazyMount(connectionAuditTarget);
  const userProfileDialogMounted = useLazyMount(profileUserId);
  const recordingsDialogMounted = useLazyMount(recordingsOpen);
  const importDialogMounted = useLazyMount(importDialogOpen);
  const exportDialogMounted = useLazyMount(exportDialogOpen);
  const geoIpDialogMounted = useLazyMount(geoIpTarget);
  const checkoutDialogMounted = useLazyMount(checkoutOpen);
  const activeGeoIpTarget = ipGeolocationEnabled ? geoIpTarget : null;

  const handleOpenSettings = (tab?: string) => {
    setSettingsInitialTab(tab);
    setSettingsOpen(true);
  };

  const navigationActions: NavigationActions = {
    openKeychain: () => setKeychainOpen(true),
    openRecordings: () => { if (recordingsEnabled) setRecordingsOpen(true); },
    openSettings: handleOpenSettings,
    openAuditLog: () => setAuditLogOpen(true),
    selectConnection: (connectionId: string) => {
      const store = useConnectionsStore.getState();
      const all = [...store.ownConnections, ...store.sharedConnections, ...store.teamConnections];
      const conn = all.find((c) => c.id === connectionId);
      if (conn) {
        useTabsStore.getState().openTab(conn);
      }
    },
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
    try { await logoutApi(); } catch {}
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
      <AppBar position="static" elevation={0} sx={{ zIndex: (theme) => theme.zIndex.drawer + 1, bgcolor: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.background.default, 0.8) : alpha(theme.palette.background.default, 0.9), color: 'text.primary', backdropFilter: 'blur(20px)', borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar variant="dense">
          <Typography variant="h6" sx={{ flexGrow: 0, mr: 2, fontFamily: (theme) => theme.typography.h5.fontFamily, fontSize: '1.4rem', color: 'text.primary' }}>
            Arsenale
          </Typography>
          {featureFlagsLoaded && multiTenancyEnabled && (
            <TenantSwitcher onCreateOrg={() => handleOpenSettings('organization')} />
          )}
          {featureFlagsLoaded && keychainEnabled && (
            <Chip
              icon={vaultUnlocked ? <LockOpenIcon /> : <LockIcon />}
              label={vaultUnlocked ? 'Vault Unlocked' : 'Vault Locked'}
              size="small"
              variant="outlined"
              onClick={vaultUnlocked ? handleLockVault : undefined}
              sx={{
                mr: 1,
                ...(vaultUnlocked
                  ? { bgcolor: (theme) => `${theme.palette.primary.main}14`, color: 'primary.main', borderColor: (theme) => `${theme.palette.primary.main}26`, '& .MuiChip-icon': { color: 'primary.main' } }
                  : { bgcolor: (theme) => `${theme.palette.error.main}14`, color: 'error.main', borderColor: (theme) => `${theme.palette.error.main}26`, '& .MuiChip-icon': { color: 'error.main' } }),
              }}
            />
          )}
          {featureFlagsLoaded && keychainEnabled && (
            <IconButton
              color="inherit"
              onClick={() => setKeychainOpen(true)}
              title="Keychain"
              sx={{ mr: 1, '&:hover': { bgcolor: (theme) => `${theme.palette.primary.main}14` } }}
            >
              <Badge badgeContent={expiringCount + pwnedCount} color="error" max={99}>
                <KeychainIcon />
              </Badge>
            </IconButton>
          )}
          <Box sx={{ flexGrow: 1 }} />
          <NotificationBell navigationActions={navigationActions} />
          <IconButton
            color="inherit"
            onClick={toggleTheme}
            title={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            sx={{ '&:hover': { bgcolor: (theme) => `${theme.palette.primary.main}14` } }}
          >
            {themeMode === 'dark' ? <LightMode /> : <DarkMode />}
          </IconButton>
          <IconButton
            color="inherit"
            onClick={(e) => setAnchorEl(e.currentTarget)}
            sx={{ '&:hover': { bgcolor: (theme) => `${theme.palette.primary.main}14` } }}
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
            slotProps={{ paper: { sx: { bgcolor: 'background.paper', border: 1, borderColor: 'divider' } } }}
          >
            <MenuItem disabled sx={{ '&.Mui-disabled': { opacity: 0.7 } }}>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>{user?.username || user?.email}</Typography>
            </MenuItem>
            <MenuItem onClick={() => { setAnchorEl(null); handleOpenSettings(); }} sx={{ '&:hover': { bgcolor: 'action.hover' } }}>
              <SettingsIcon fontSize="small" sx={{ mr: 1 }} />
              Settings
            </MenuItem>
            <MenuItem onClick={() => { setAnchorEl(null); setAuditLogOpen(true); }} sx={{ '&:hover': { bgcolor: 'action.hover' } }}>
              <HistoryIcon fontSize="small" sx={{ mr: 1 }} />
              Activity Log
            </MenuItem>
            {recordingsEnabled && (
              <MenuItem onClick={() => { setAnchorEl(null); setRecordingsOpen(true); }} sx={{ '&:hover': { bgcolor: 'action.hover' } }}>
                <VideocamIcon fontSize="small" sx={{ mr: 1 }} />
                Recordings
              </MenuItem>
            )}
            {sharingApprovalsEnabled && (
              <MenuItem onClick={() => { setAnchorEl(null); setCheckoutOpen(true); }} sx={{ '&:hover': { bgcolor: 'action.hover' } }}>
                <CheckoutIcon fontSize="small" sx={{ mr: 1 }} />
                Credential Check-out
              </MenuItem>
            )}
            <MenuItem onClick={handleLogout} sx={{ '&:hover': { bgcolor: 'action.hover' } }}>Logout</MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar */}
        {anyConnectionFeature && (
          <Box
            sx={{
              width: SIDEBAR_WIDTH,
              minWidth: SIDEBAR_WIDTH,
              borderRight: 1, borderColor: 'divider',
              display: 'flex',
              flexDirection: 'column',
              bgcolor: 'background.paper',
              color: 'text.primary',
              userSelect: 'none',
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
            <Box sx={{ flex: 1, overflow: 'auto' }}>
              <ConnectionTree
                onEditConnection={handleEditConnection}
                onShareConnection={handleShareConnection}
                onConnectAsConnection={setConnectAsTarget}
                onCreateConnection={handleCreateConnection}
                onCreateFolder={handleCreateFolder}
                onEditFolder={handleEditFolder}
                onShareFolder={handleShareFolder}
                onViewAuditLog={(conn) => setConnectionAuditTarget({ id: conn.id, name: conn.name })}
              />
            </Box>
            <VersionIndicator />
          </Box>
        )}

        {/* Main content */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {anyConnectionFeature ? (
            <>
              <TabBar />
              <TabPanel />
            </>
          ) : (
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography variant="body1" color="text.secondary">
                Connection management is disabled.
              </Typography>
            </Box>
          )}
        </Box>
      </Box>

      {anyConnectionFeature && connectionDialogMounted && (
        <Suspense fallback={null}>
          <ConnectionDialog
            open={connectionDialogOpen}
            onClose={() => { setConnectionDialogOpen(false); setEditingConnection(null); setConnectionFolderId(null); setConnectionTeamId(null); }}
            connection={editingConnection}
            folderId={connectionFolderId}
            teamId={connectionTeamId}
          />
        </Suspense>
      )}
      {anyConnectionFeature && folderDialogMounted && (
        <Suspense fallback={null}>
          <FolderDialog
            open={folderDialogOpen}
            onClose={() => { setFolderDialogOpen(false); setEditingFolder(null); setNewFolderParentId(null); setFolderTeamId(null); }}
            folder={editingFolder}
            parentId={newFolderParentId}
            teamId={folderTeamId}
          />
        </Suspense>
      )}
      {anyConnectionFeature && shareDialogMounted && (
        <Suspense fallback={null}>
          <ShareDialog
            open={!!shareTarget}
            onClose={() => setShareTarget(null)}
            connectionId={shareTarget?.id ?? ''}
            connectionName={shareTarget?.name ?? ''}
            teamId={shareTarget?.teamId}
          />
        </Suspense>
      )}
      {anyConnectionFeature && shareFolderDialogMounted && (
        <Suspense fallback={null}>
          <ShareFolderDialog
            open={!!shareFolderTarget}
            onClose={() => setShareFolderTarget(null)}
            folderId={shareFolderTarget?.folderId ?? ''}
            folderName={shareFolderTarget?.folderName ?? ''}
          />
        </Suspense>
      )}
      {anyConnectionFeature && connectAsDialogMounted && (
        <Suspense fallback={null}>
          <ConnectAsDialog
            open={!!connectAsTarget}
            onClose={() => setConnectAsTarget(null)}
            connection={connectAsTarget}
          />
        </Suspense>
      )}

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

      {settingsDialogMounted && (
        <Suspense fallback={null}>
          <SettingsDialog
            open={settingsOpen}
            onClose={() => { setSettingsOpen(false); setLinkedProvider(null); fetchFeatureFlags(); }}
            initialTab={settingsInitialTab}
            linkedProvider={linkedProvider}
            onViewUserProfile={(uid) => setProfileUserId(uid)}
            onGeoIpClick={ipGeolocationEnabled ? setGeoIpTarget : undefined}
            onImport={() => setImportDialogOpen(true)}
            onExport={() => setExportDialogOpen(true)}
          />
        </Suspense>
      )}
      {auditLogDialogMounted && (
        <Suspense fallback={null}>
          <AuditLogDialog
            open={auditLogOpen}
            onClose={() => setAuditLogOpen(false)}
            onGeoIpClick={ipGeolocationEnabled ? setGeoIpTarget : undefined}
          />
        </Suspense>
      )}
      {keychainEnabled && keychainDialogMounted && (
        <Suspense fallback={null}>
          <KeychainDialog
            open={keychainOpen}
            onClose={() => setKeychainOpen(false)}
          />
        </Suspense>
      )}
      {anyConnectionFeature && connectionAuditDialogMounted && (
        <Suspense fallback={null}>
          <ConnectionAuditLogDialog
            open={!!connectionAuditTarget}
            onClose={() => setConnectionAuditTarget(null)}
            connectionId={connectionAuditTarget?.id ?? ''}
            connectionName={connectionAuditTarget?.name ?? ''}
            onGeoIpClick={ipGeolocationEnabled ? setGeoIpTarget : undefined}
          />
        </Suspense>
      )}
      {userProfileDialogMounted && (
        <Suspense fallback={null}>
          <UserProfileDialog
            open={!!profileUserId}
            onClose={() => setProfileUserId(null)}
            userId={profileUserId}
          />
        </Suspense>
      )}
      {recordingsEnabled && recordingsDialogMounted && (
        <Suspense fallback={null}>
          <RecordingsDialog
            open={recordingsOpen}
            onClose={() => setRecordingsOpen(false)}
          />
        </Suspense>
      )}
      {anyConnectionFeature && importDialogMounted && (
        <Suspense fallback={null}>
          <ImportDialog
            open={importDialogOpen}
            onClose={() => { setImportDialogOpen(false); useConnectionsStore.getState().fetchConnections(); }}
          />
        </Suspense>
      )}
      {anyConnectionFeature && exportDialogMounted && (
        <Suspense fallback={null}>
          <ExportDialog
            open={exportDialogOpen}
            onClose={() => setExportDialogOpen(false)}
          />
        </Suspense>
      )}
      {activeGeoIpTarget && geoIpDialogMounted && (
        <Suspense fallback={null}>
          <GeoIpDialog
            open={!!activeGeoIpTarget}
            onClose={() => setGeoIpTarget(null)}
            ipAddress={activeGeoIpTarget}
          />
        </Suspense>
      )}
      {sharingApprovalsEnabled && checkoutDialogMounted && (
        <Suspense fallback={null}>
          <CheckoutDialog
            open={checkoutOpen}
            onClose={() => setCheckoutOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}
