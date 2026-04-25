import { Suspense, lazy, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import CommandPalette from './CommandPalette';
import DashboardPanel from './DashboardPanel';
import StatusBar from './StatusBar';
import type { ConnectionData } from '@/api/connections.api';
import { useDlpBrowserHardening } from '@/hooks/useDlpBrowserHardening';
import { useGatewayMonitor } from '@/hooks/useGatewayMonitor';
import { useActivityTouch } from '@/hooks/useActivityTouch';
import { useLazyMount } from '@/hooks/useLazyMount';
import { useSessionCountMonitor } from '@/hooks/useSessionCountMonitor';
import { useShareSync } from '@/hooks/useShareSync';
import { useFeatureFlagsStore } from '@/store/featureFlagsStore';
import { useAuthStore } from '@/store/authStore';
import { useConnectionsStore, type Folder } from '@/store/connectionsStore';
import { useNotificationStore } from '@/store/notificationStore';
import { useSecretStore } from '@/store/secretStore';
import { useTabsStore } from '@/store/tabsStore';
import { useTerminalSettingsStore } from '@/store/terminalSettingsStore';
import { useUiPreferencesStore } from '@/store/uiPreferencesStore';
import { useVaultStore } from '@/store/vaultStore';
import type { NavigationActions } from '@/utils/notificationActions';
import { NotificationToast } from '../Layout/layoutUi';
import {
  resolveSessionsRouteState,
  type SessionsRouteState,
} from '@/components/sessions/sessionConsoleRoute';
import AppSidebar from './AppSidebar';
import MiniHeader from './MiniHeader';
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
const ExportDialog = lazy(() => import('../Dialogs/ExportDialog'));
const ImportDialog = lazy(() => import('../Dialogs/ImportDialog'));
const GeoIpDialog = lazy(() => import('../Audit/GeoIpDialog'));
const CheckoutDialog = lazy(() => import('../Dialogs/CheckoutDialog'));
const SessionsDialog = lazy(() => import('@/components/sessions/SessionsDialog'));

interface WorkspaceShellProps {
  view?: 'dashboard';
  initialSessionsDialogOpen?: boolean;
  initialSessionsDialogState?: Partial<SessionsRouteState>;
}

export default function WorkspaceShell({
  initialSessionsDialogOpen = false,
  initialSessionsDialogState,
}: WorkspaceShellProps) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const fetchCurrentPermissions = useAuthStore((s) => s.fetchCurrentPermissions);
  const vaultUnlocked = useVaultStore((s) => s.unlocked);
  const vaultInitialized = useVaultStore((s) => s.initialized);
  const notification = useNotificationStore((s) => s.notification);
  const clearNotification = useNotificationStore((s) => s.clear);
  const fetchTerminalDefaults = useTerminalSettingsStore((s) => s.fetchDefaults);
  const terminalDefaultsLoaded = useTerminalSettingsStore((s) => s.loaded);
  const fetchCounts = useSecretStore((s) => s.fetchCounts);
  const connectionsEnabled = useFeatureFlagsStore((s) => s.connectionsEnabled);
  const databaseProxyEnabled = useFeatureFlagsStore((s) => s.databaseProxyEnabled);
  const ipGeolocationEnabled = useFeatureFlagsStore((s) => s.ipGeolocationEnabled);
  const keychainEnabled = useFeatureFlagsStore((s) => s.keychainEnabled);
  const featureFlagsLoaded = useFeatureFlagsStore((s) => s.loaded);
  const sharingApprovalsEnabled = useFeatureFlagsStore((s) => s.sharingApprovalsEnabled);
  const fetchFeatureFlags = useFeatureFlagsStore((s) => s.fetchFeatureFlags);
  const checkVaultStatus = useVaultStore((s) => s.checkStatus);
  const tabs = useTabsStore((s) => s.tabs);
  const anyConnectionFeature = connectionsEnabled || databaseProxyEnabled;
  const vaultLocked = vaultInitialized && !vaultUnlocked;

  const uiZoomLevel = useUiPreferencesStore((s) => s.uiZoomLevel);

  useGatewayMonitor();
  useActivityTouch();
  useSessionCountMonitor();
  useShareSync();
  useDlpBrowserHardening();
  useGlobalShortcuts();

  useEffect(() => {
    document.documentElement.style.fontSize = `${uiZoomLevel}%`;
    return () => {
      document.documentElement.style.fontSize = '100%';
    };
  }, [uiZoomLevel]);

  useEffect(() => {
    const prevent = (event: MouseEvent) => event.preventDefault();
    document.addEventListener('contextmenu', prevent, { capture: true });
    return () => document.removeEventListener('contextmenu', prevent, { capture: true });
  }, []);

  useEffect(() => {
    if (!terminalDefaultsLoaded) fetchTerminalDefaults();
  }, [fetchTerminalDefaults, terminalDefaultsLoaded]);

  useEffect(() => {
    if (!accessToken) return;
    void fetchCurrentPermissions();
  }, [accessToken, fetchCurrentPermissions, user?.id, user?.tenantId]);

  useEffect(() => {
    if (vaultUnlocked) fetchCounts();
  }, [fetchCounts, vaultUnlocked]);

  useEffect(() => {
    if (!featureFlagsLoaded || !keychainEnabled) return;
    void checkVaultStatus();
  }, [checkVaultStatus, featureFlagsLoaded, keychainEnabled]);

  useEffect(() => {
    if (!notification) return undefined;
    const timeoutId = window.setTimeout(() => clearNotification(), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [clearNotification, notification]);

  // --- PWA action handling ---
  const [pwaAction] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    if (action) window.history.replaceState({}, '', '/');
    return action;
  });

  // --- Dialog state (inherited from MainLayout, migrated in future phases) ---
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
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [connectionAuditTarget, setConnectionAuditTarget] = useState<{ id: string; name: string } | null>(null);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [geoIpTarget, setGeoIpTarget] = useState<string | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [sessionsDialogOpen, setSessionsDialogOpen] = useState(initialSessionsDialogOpen);
  const [sessionsDialogState, setSessionsDialogState] = useState<SessionsRouteState>(() => resolveSessionsRouteState(initialSessionsDialogState));
  const [linkedProvider, setLinkedProvider] = useState<string | null>(() => {
    const linked = new URLSearchParams(window.location.search).get('linked');
    if (linked) window.history.replaceState({}, '', '/');
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
  const importDialogMounted = useLazyMount(importDialogOpen);
  const exportDialogMounted = useLazyMount(exportDialogOpen);
  const geoIpDialogMounted = useLazyMount(geoIpTarget);
  const checkoutDialogMounted = useLazyMount(checkoutOpen);
  const sessionsDialogMounted = useLazyMount(sessionsDialogOpen);
  const activeGeoIpTarget = ipGeolocationEnabled ? geoIpTarget : null;

  const openSessions = (initialState?: Partial<SessionsRouteState>) => {
    setSessionsDialogState(resolveSessionsRouteState(initialState));
    setSessionsDialogOpen(true);
  };

  const openRecordedSessions = () => openSessions({ status: ['CLOSED'], recorded: true });

  const handleOpenSettings = (tab?: string) => {
    setSettingsInitialTab(tab);
    setSettingsOpen(true);
  };

  const navigationActions: NavigationActions = {
    openKeychain: () => setKeychainOpen(true),
    openRecordings: openRecordedSessions,
    openSettings: handleOpenSettings,
    openAuditLog: () => setAuditLogOpen(true),
    selectConnection: (connectionId: string) => {
      const store = useConnectionsStore.getState();
      const allConnections = [...store.ownConnections, ...store.sharedConnections, ...store.teamConnections];
      const connection = allConnections.find((c) => c.id === connectionId);
      if (connection) useTabsStore.getState().openTab(connection);
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

  return (
    <SidebarProvider>
      <AppSidebar
        onEditConnection={handleEditConnection}
        onShareConnection={(conn) => setShareTarget(conn)}
        onConnectAsConnection={setConnectAsTarget}
        onCreateConnection={handleCreateConnection}
        onCreateFolder={handleCreateFolder}
        onEditFolder={handleEditFolder}
        onShareFolder={(folderId, folderName) => setShareFolderTarget({ folderId, folderName })}
        onViewAuditLog={(conn) => setConnectionAuditTarget({ id: conn.id, name: conn.name })}
        onOpenSettings={handleOpenSettings}
        onOpenKeychain={() => setKeychainOpen(true)}
        onOpenAuditLog={() => setAuditLogOpen(true)}
        onOpenSessions={() => openSessions()}
      />

      <SidebarInset>
        <div
          className={cn(
            'flex h-full flex-col transition-[filter] duration-200',
            vaultLocked && 'pointer-events-none select-none blur-md',
          )}
        >
          <MiniHeader
            navigationActions={navigationActions}
            onOpenSettings={handleOpenSettings}
          />

          {/* Main workspace area */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {anyConnectionFeature ? (
              <>
                <TabBar />
                {tabs.length > 0 ? (
                  <TabPanel />
                ) : (
                  <DashboardPanel
                    onCreateConnection={() => handleCreateConnection()}
                    onOpenKeychain={() => setKeychainOpen(true)}
                    onOpenSessions={() => openSessions()}
                  />
                )}
              </>
            ) : (
              <DashboardPanel
                onCreateConnection={() => handleCreateConnection()}
                onOpenKeychain={() => setKeychainOpen(true)}
                onOpenSessions={() => openSessions()}
              />
            )}
          </div>

          <StatusBar onOpenSettings={handleOpenSettings} onOpenSessions={() => openSessions()} />
        </div>
      </SidebarInset>

      {/* Command palette */}
      <CommandPalette
        onOpenSettings={handleOpenSettings}
        onCreateConnection={() => handleCreateConnection()}
        onOpenKeychain={() => setKeychainOpen(true)}
        onOpenAuditLog={() => setAuditLogOpen(true)}
        onOpenSessions={() => openSessions()}
      />

      {/* Notification toast */}
      {notification ? (
        <NotificationToast
          message={notification.message}
          severity={notification.severity}
          onClose={clearNotification}
        />
      ) : null}

      {/* ===== Modal dialogs (kept from MainLayout) ===== */}
      {anyConnectionFeature && connectionDialogMounted ? (
        <Suspense fallback={null}>
          <ConnectionDialog
            open={connectionDialogOpen}
            onClose={() => { setConnectionDialogOpen(false); setEditingConnection(null); setConnectionFolderId(null); setConnectionTeamId(null); }}
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
            onClose={() => { setFolderDialogOpen(false); setEditingFolder(null); setNewFolderParentId(null); setFolderTeamId(null); }}
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
            onClose={() => { setSettingsOpen(false); setLinkedProvider(null); fetchFeatureFlags(); }}
            initialTab={settingsInitialTab}
            linkedProvider={linkedProvider}
            onOpenSessions={openSessions}
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
          <UserProfileDialog open={Boolean(profileUserId)} onClose={() => setProfileUserId(null)} userId={profileUserId} />
        </Suspense>
      ) : null}
      {anyConnectionFeature && importDialogMounted ? (
        <Suspense fallback={null}>
          <ImportDialog open={importDialogOpen} onClose={() => { setImportDialogOpen(false); useConnectionsStore.getState().fetchConnections(); }} />
        </Suspense>
      ) : null}
      {anyConnectionFeature && exportDialogMounted ? (
        <Suspense fallback={null}>
          <ExportDialog open={exportDialogOpen} onClose={() => setExportDialogOpen(false)} />
        </Suspense>
      ) : null}
      {activeGeoIpTarget && geoIpDialogMounted ? (
        <Suspense fallback={null}>
          <GeoIpDialog open={Boolean(activeGeoIpTarget)} onClose={() => setGeoIpTarget(null)} ipAddress={activeGeoIpTarget} />
        </Suspense>
      ) : null}
      {sharingApprovalsEnabled && checkoutDialogMounted ? (
        <Suspense fallback={null}>
          <CheckoutDialog open={checkoutOpen} onClose={() => setCheckoutOpen(false)} />
        </Suspense>
      ) : null}
      {sessionsDialogMounted ? (
        <Suspense fallback={null}>
          <SessionsDialog
            open={sessionsDialogOpen}
            onClose={() => setSessionsDialogOpen(false)}
            initialState={sessionsDialogState}
          />
        </Suspense>
      ) : null}
    </SidebarProvider>
  );
}
