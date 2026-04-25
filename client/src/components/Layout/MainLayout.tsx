import { Suspense, lazy, useEffect, useState } from 'react';
import {
  History,
  KeyRound,
  Lock,
  LockOpen,
  MoonStar,
  Settings2,
  SunMedium,
  Video,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { ConnectionData } from '@/api/connections.api';
import { logoutApi } from '@/api/auth.api';
import { lockVault } from '@/api/vault.api';
import { broadcastVaultWindowSync } from '@/utils/vaultWindowSync';
import ConnectionTree from '../Sidebar/ConnectionTree';
import TabBar from '../Tabs/TabBar';
import TabPanel from '../Tabs/TabPanel';
import NotificationBell from './NotificationBell';
import TenantSwitcher from './TenantSwitcher';
import VersionIndicator from './VersionIndicator';
import {
  CounterBadge,
  HeaderIconButton,
  NotificationToast,
  StatusPill,
} from './layoutUi';
import { useDlpBrowserHardening } from '../../hooks/useDlpBrowserHardening';
import { useGatewayMonitor } from '../../hooks/useGatewayMonitor';
import { useLazyMount } from '../../hooks/useLazyMount';
import { useShareSync } from '../../hooks/useShareSync';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';
import { useAuthStore } from '../../store/authStore';
import { useConnectionsStore, type Folder } from '../../store/connectionsStore';
import { useNotificationStore } from '../../store/notificationStore';
import { useSecretStore } from '../../store/secretStore';
import { useTabsStore } from '../../store/tabsStore';
import { useTerminalSettingsStore } from '../../store/terminalSettingsStore';
import { useThemeStore } from '../../store/themeStore';
import { useVaultStore } from '../../store/vaultStore';
import type { NavigationActions } from '../../utils/notificationActions';

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

const SIDEBAR_WIDTH = 280;

function userInitial(user: { username?: string | null; email?: string | null } | null | undefined) {
  return (user?.username || user?.email || '?').trim().charAt(0).toUpperCase();
}

export default function MainLayout() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const user = useAuthStore((state) => state.user);
  const authLogout = useAuthStore((state) => state.logout);
  const fetchCurrentPermissions = useAuthStore((state) => state.fetchCurrentPermissions);
  const vaultUnlocked = useVaultStore((state) => state.unlocked);
  const vaultInitialized = useVaultStore((state) => state.initialized);
  const setVaultUnlocked = useVaultStore((state) => state.setUnlocked);
  const checkVaultStatus = useVaultStore((state) => state.checkStatus);
  const notification = useNotificationStore((state) => state.notification);
  const clearNotification = useNotificationStore((state) => state.clear);
  const themeMode = useThemeStore((state) => state.mode);
  const toggleTheme = useThemeStore((state) => state.toggle);
  const fetchTerminalDefaults = useTerminalSettingsStore((state) => state.fetchDefaults);
  const terminalDefaultsLoaded = useTerminalSettingsStore((state) => state.loaded);
  const expiringCount = useSecretStore((state) => state.expiringCount);
  const pwnedCount = useSecretStore((state) => state.pwnedCount);
  const fetchCounts = useSecretStore((state) => state.fetchCounts);
  const connectionsEnabled = useFeatureFlagsStore((state) => state.connectionsEnabled);
  const databaseProxyEnabled = useFeatureFlagsStore((state) => state.databaseProxyEnabled);
  const ipGeolocationEnabled = useFeatureFlagsStore((state) => state.ipGeolocationEnabled);
  const keychainEnabled = useFeatureFlagsStore((state) => state.keychainEnabled);
  const multiTenancyEnabled = useFeatureFlagsStore((state) => state.multiTenancyEnabled);
  const featureFlagsLoaded = useFeatureFlagsStore((state) => state.loaded);
  const recordingsEnabled = useFeatureFlagsStore((state) => state.recordingsEnabled);
  const sharingApprovalsEnabled = useFeatureFlagsStore((state) => state.sharingApprovalsEnabled);
  const fetchFeatureFlags = useFeatureFlagsStore((state) => state.fetchFeatureFlags);
  const anyConnectionFeature = connectionsEnabled || databaseProxyEnabled;
  const vaultLocked = vaultInitialized && !vaultUnlocked;

  useGatewayMonitor();
  useShareSync();
  useDlpBrowserHardening();

  useEffect(() => {
    const prevent = (event: MouseEvent) => event.preventDefault();
    document.addEventListener('contextmenu', prevent, { capture: true });
    return () => document.removeEventListener('contextmenu', prevent, { capture: true });
  }, []);

  useEffect(() => {
    if (!terminalDefaultsLoaded) {
      fetchTerminalDefaults();
    }
  }, [fetchTerminalDefaults, terminalDefaultsLoaded]);

  useEffect(() => {
    if (!accessToken) {
      return;
    }
    void fetchCurrentPermissions();
  }, [accessToken, fetchCurrentPermissions, user?.id, user?.tenantId]);

  useEffect(() => {
    if (vaultUnlocked) {
      fetchCounts();
    }
  }, [fetchCounts, vaultUnlocked]);

  useEffect(() => {
    if (!featureFlagsLoaded || !keychainEnabled) {
      return;
    }
    void checkVaultStatus();
  }, [checkVaultStatus, featureFlagsLoaded, keychainEnabled]);

  useEffect(() => {
    if (!notification) {
      return undefined;
    }
    const timeoutId = window.setTimeout(() => clearNotification(), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [clearNotification, notification]);

  const [pwaAction] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    if (action) {
      window.history.replaceState({}, '', '/');
    }
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
    if (linked) {
      window.history.replaceState({}, '', '/');
    }
    return linked;
  });

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
    openRecordings: () => {
      if (recordingsEnabled) {
        setRecordingsOpen(true);
      }
    },
    openSettings: handleOpenSettings,
    openAuditLog: () => setAuditLogOpen(true),
    selectConnection: (connectionId: string) => {
      const store = useConnectionsStore.getState();
      const allConnections = [...store.ownConnections, ...store.sharedConnections, ...store.teamConnections];
      const connection = allConnections.find((candidate) => candidate.id === connectionId);
      if (connection) {
        useTabsStore.getState().openTab(connection);
      }
    },
  };

  const handleEditConnection = (connection: ConnectionData) => {
    setEditingConnection(connection);
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

  const handleLogout = async () => {
    try {
      await logoutApi();
    } catch {
      // Ignore logout API errors and clear local state anyway.
    }
    await useTabsStore.getState().clearAll();
    authLogout();
  };

  const handleLockVault = async () => {
    try {
      await lockVault();
      setVaultUnlocked(false);
      broadcastVaultWindowSync('lock');
    } catch {
      // Keep the current vault status if locking fails.
    }
  };

  return (
    <>
      <div
        className={cn(
          'flex h-screen flex-col transition-[filter] duration-200',
          vaultLocked && 'pointer-events-none select-none blur-md',
        )}
      >
        <header className="border-b bg-background/85 backdrop-blur-xl">
          <div className="flex h-14 items-center gap-2 px-4">
            <div className="font-heading text-[1.35rem] tracking-tight text-foreground">
              Arsenale
            </div>

            {featureFlagsLoaded && multiTenancyEnabled ? (
              <TenantSwitcher onCreateOrg={() => handleOpenSettings('organization')} />
            ) : null}

            {featureFlagsLoaded && keychainEnabled ? (
              <StatusPill
                tone={vaultUnlocked ? 'primary' : 'danger'}
                onClick={vaultUnlocked ? () => void handleLockVault() : undefined}
                disabled={!vaultUnlocked}
              >
                {vaultUnlocked ? <LockOpen className="size-3.5" /> : <Lock className="size-3.5" />}
                {vaultUnlocked ? 'Vault Unlocked' : 'Vault Locked'}
              </StatusPill>
            ) : null}

            {featureFlagsLoaded && keychainEnabled ? (
              <HeaderIconButton
                aria-label="Keychain"
                title="Keychain"
                onClick={() => setKeychainOpen(true)}
              >
                <KeyRound className="size-4" />
                <CounterBadge count={expiringCount + pwnedCount} />
              </HeaderIconButton>
            ) : null}

            <div className="ml-auto flex items-center gap-1">
              <NotificationBell navigationActions={navigationActions} />

              <HeaderIconButton
                aria-label={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                title={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                onClick={toggleTheme}
              >
                {themeMode === 'dark' ? (
                  <SunMedium className="size-4" />
                ) : (
                  <MoonStar className="size-4" />
                )}
              </HeaderIconButton>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <HeaderIconButton aria-label="Account menu">
                    <Avatar className="size-8">
                      {user?.avatarData ? <AvatarImage src={user.avatarData} alt={user.username || user.email || 'User'} /> : null}
                      <AvatarFallback>{userInitial(user)}</AvatarFallback>
                    </Avatar>
                  </HeaderIconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel className="space-y-0.5">
                    <div className="truncate text-sm font-medium text-foreground">
                      {user?.username || user?.email}
                    </div>
                    {user?.email && user?.username ? (
                      <div className="truncate text-xs text-muted-foreground">{user.email}</div>
                    ) : null}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => handleOpenSettings()}>
                    <Settings2 className="size-4" />
                    Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setAuditLogOpen(true)}>
                    <History className="size-4" />
                    Activity Log
                  </DropdownMenuItem>
                  {recordingsEnabled ? (
                    <DropdownMenuItem onSelect={() => setRecordingsOpen(true)}>
                      <Video className="size-4" />
                      Recordings
                    </DropdownMenuItem>
                  ) : null}
                  {sharingApprovalsEnabled ? (
                    <DropdownMenuItem onSelect={() => setCheckoutOpen(true)}>
                      <KeyRound className="size-4" />
                      Credential Check-out
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void handleLogout()}>
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {anyConnectionFeature ? (
            <aside
              className="flex shrink-0 flex-col border-r bg-card/30"
              style={{ width: SIDEBAR_WIDTH, minWidth: SIDEBAR_WIDTH }}
            >
              {!user?.tenantId ? (
                <div className="p-3">
                  <Alert variant="info">
                    <AlertTitle>Organization setup</AlertTitle>
                    <AlertDescription className="space-y-3">
                      <p>Set up an organization to create teams and collaborate.</p>
                      <Button type="button" size="sm" onClick={() => handleOpenSettings('organization')}>
                        Get Started
                      </Button>
                    </AlertDescription>
                  </Alert>
                </div>
              ) : null}
              <div className="min-h-0 flex-1 overflow-auto">
                <ConnectionTree
                  onEditConnection={handleEditConnection}
                  onShareConnection={(connection) => setShareTarget(connection)}
                  onConnectAsConnection={setConnectAsTarget}
                  onCreateConnection={handleCreateConnection}
                  onCreateFolder={handleCreateFolder}
                  onEditFolder={handleEditFolder}
                  onShareFolder={(folderId, folderName) => setShareFolderTarget({ folderId, folderName })}
                  onViewAuditLog={(connection) => setConnectionAuditTarget({ id: connection.id, name: connection.name })}
                />
              </div>
              <VersionIndicator />
            </aside>
          ) : null}

          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {anyConnectionFeature ? (
              <>
                <TabBar />
                <TabPanel />
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center px-6 text-center">
                <p className="text-sm text-muted-foreground">
                  Connection management is disabled.
                </p>
              </div>
            )}
          </main>
        </div>
      </div>

      {notification ? (
        <NotificationToast
          message={notification.message}
          severity={notification.severity}
          onClose={clearNotification}
        />
      ) : null}

      {anyConnectionFeature && connectionDialogMounted ? (
        <Suspense fallback={null}>
          <ConnectionDialog
            open={connectionDialogOpen}
            onClose={() => {
              setConnectionDialogOpen(false);
              setEditingConnection(null);
              setConnectionFolderId(null);
              setConnectionTeamId(null);
            }}
            connection={editingConnection}
            folderId={connectionFolderId}
            teamId={connectionTeamId}
          />
        </Suspense>
      ) : null}
      {anyConnectionFeature && folderDialogMounted ? (
        <Suspense fallback={null}>
          <FolderDialog
            open={folderDialogOpen}
            onClose={() => {
              setFolderDialogOpen(false);
              setEditingFolder(null);
              setNewFolderParentId(null);
              setFolderTeamId(null);
            }}
            folder={editingFolder}
            parentId={newFolderParentId}
            teamId={folderTeamId}
          />
        </Suspense>
      ) : null}
      {anyConnectionFeature && shareDialogMounted ? (
        <Suspense fallback={null}>
          <ShareDialog
            open={Boolean(shareTarget)}
            onClose={() => setShareTarget(null)}
            connectionId={shareTarget?.id ?? ''}
            connectionName={shareTarget?.name ?? ''}
            teamId={shareTarget?.teamId}
          />
        </Suspense>
      ) : null}
      {anyConnectionFeature && shareFolderDialogMounted ? (
        <Suspense fallback={null}>
          <ShareFolderDialog
            open={Boolean(shareFolderTarget)}
            onClose={() => setShareFolderTarget(null)}
            folderId={shareFolderTarget?.folderId ?? ''}
            folderName={shareFolderTarget?.folderName ?? ''}
          />
        </Suspense>
      ) : null}
      {anyConnectionFeature && connectAsDialogMounted ? (
        <Suspense fallback={null}>
          <ConnectAsDialog
            open={Boolean(connectAsTarget)}
            onClose={() => setConnectAsTarget(null)}
            connection={connectAsTarget}
          />
        </Suspense>
      ) : null}

      {settingsDialogMounted ? (
        <Suspense fallback={null}>
          <SettingsDialog
            open={settingsOpen}
            onClose={() => {
              setSettingsOpen(false);
              setLinkedProvider(null);
              fetchFeatureFlags();
            }}
            initialTab={settingsInitialTab}
            linkedProvider={linkedProvider}
            onViewUserProfile={(userId) => setProfileUserId(userId)}
            onImport={() => setImportDialogOpen(true)}
            onExport={() => setExportDialogOpen(true)}
          />
        </Suspense>
      ) : null}
      {auditLogDialogMounted ? (
        <Suspense fallback={null}>
          <AuditLogDialog
            open={auditLogOpen}
            onClose={() => setAuditLogOpen(false)}
            onGeoIpClick={ipGeolocationEnabled ? setGeoIpTarget : undefined}
            onViewUserProfile={(userId) => setProfileUserId(userId)}
          />
        </Suspense>
      ) : null}
      {keychainEnabled && keychainDialogMounted ? (
        <Suspense fallback={null}>
          <KeychainDialog open={keychainOpen} onClose={() => setKeychainOpen(false)} />
        </Suspense>
      ) : null}
      {anyConnectionFeature && connectionAuditDialogMounted ? (
        <Suspense fallback={null}>
          <ConnectionAuditLogDialog
            open={Boolean(connectionAuditTarget)}
            onClose={() => setConnectionAuditTarget(null)}
            connectionId={connectionAuditTarget?.id ?? ''}
            connectionName={connectionAuditTarget?.name ?? ''}
            onGeoIpClick={ipGeolocationEnabled ? setGeoIpTarget : undefined}
          />
        </Suspense>
      ) : null}
      {userProfileDialogMounted ? (
        <Suspense fallback={null}>
          <UserProfileDialog
            open={Boolean(profileUserId)}
            onClose={() => setProfileUserId(null)}
            userId={profileUserId}
          />
        </Suspense>
      ) : null}
      {recordingsEnabled && recordingsDialogMounted ? (
        <Suspense fallback={null}>
          <RecordingsDialog open={recordingsOpen} onClose={() => setRecordingsOpen(false)} />
        </Suspense>
      ) : null}
      {anyConnectionFeature && importDialogMounted ? (
        <Suspense fallback={null}>
          <ImportDialog
            open={importDialogOpen}
            onClose={() => {
              setImportDialogOpen(false);
              useConnectionsStore.getState().fetchConnections();
            }}
          />
        </Suspense>
      ) : null}
      {anyConnectionFeature && exportDialogMounted ? (
        <Suspense fallback={null}>
          <ExportDialog open={exportDialogOpen} onClose={() => setExportDialogOpen(false)} />
        </Suspense>
      ) : null}
      {activeGeoIpTarget && geoIpDialogMounted ? (
        <Suspense fallback={null}>
          <GeoIpDialog
            open={Boolean(activeGeoIpTarget)}
            onClose={() => setGeoIpTarget(null)}
            ipAddress={activeGeoIpTarget}
          />
        </Suspense>
      ) : null}
      {sharingApprovalsEnabled && checkoutDialogMounted ? (
        <Suspense fallback={null}>
          <CheckoutDialog open={checkoutOpen} onClose={() => setCheckoutOpen(false)} />
        </Suspense>
      ) : null}
    </>
  );
}
