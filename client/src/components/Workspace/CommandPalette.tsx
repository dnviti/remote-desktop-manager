import { useMemo } from 'react';
import {
  Activity,
  DatabaseZap,
  History,
  Key,
  KeyRound,
  Lock,
  Monitor,
  MoonStar,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  StickyNote,
  SunMedium,
  TerminalSquare,
  Webhook,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { useConnectionsStore } from '@/store/connectionsStore';
import { useTabsStore } from '@/store/tabsStore';
import { useThemeStore } from '@/store/themeStore';
import { useVaultStore } from '@/store/vaultStore';
import { useUiPreferencesStore } from '@/store/uiPreferencesStore';
import { useFeatureFlagsStore } from '@/store/featureFlagsStore';
import { useCommandPaletteStore } from '@/store/commandPaletteStore';
import { useSecretStore } from '@/store/secretStore';
import { lockVault } from '@/api/vault.api';
import { broadcastVaultWindowSync } from '@/utils/vaultWindowSync';
import { getRecentConnectionIds } from '@/utils/recentConnections';
import { useAuthStore } from '@/store/authStore';
import {
  buildSettingsConcerns,
  type SettingsConcernContext,
} from '@/components/Dialogs/settingsConcerns';
import type { SecretType } from '@/api/secrets.api';
import type { ConnectionData } from '@/api/connections.api';
import type { ConnectionFilter } from './AppSidebar';

const SECRET_TYPE_ICONS: Record<SecretType, React.ReactNode> = {
  LOGIN: <KeyRound className="size-4" />,
  SSH_KEY: <Key className="size-4" />,
  CERTIFICATE: <ShieldCheck className="size-4" />,
  API_KEY: <Webhook className="size-4" />,
  SECURE_NOTE: <StickyNote className="size-4" />,
};

const SECRET_TYPE_LABELS: Record<SecretType, string> = {
  LOGIN: 'Login',
  SSH_KEY: 'SSH Key',
  CERTIFICATE: 'Certificate',
  API_KEY: 'API Key',
  SECURE_NOTE: 'Secure Note',
};

function connectionIcon(type: string) {
  switch (type) {
    case 'SSH': return <TerminalSquare className="size-4" />;
    case 'DATABASE': return <DatabaseZap className="size-4" />;
    default: return <Monitor className="size-4" />;
  }
}

interface CommandPaletteProps {
  onOpenSettings: (tab?: string) => void;
  onCreateConnection: () => void;
  onOpenKeychain: () => void;
  onOpenAuditLog: () => void;
  onOpenSessions: () => void;
}

export default function CommandPalette({
  onOpenSettings,
  onCreateConnection,
  onOpenKeychain,
  onOpenAuditLog,
  onOpenSessions,
}: CommandPaletteProps) {
  const open = useCommandPaletteStore((s) => s.open);
  const setOpen = useCommandPaletteStore((s) => s.setOpen);

  const ownConnections = useConnectionsStore((s) => s.ownConnections);
  const sharedConnections = useConnectionsStore((s) => s.sharedConnections);
  const teamConnections = useConnectionsStore((s) => s.teamConnections);
  const tabs = useTabsStore((s) => s.tabs);
  const openTab = useTabsStore((s) => s.openTab);
  const setActiveTab = useTabsStore((s) => s.setActiveTab);
  const themeMode = useThemeStore((s) => s.mode);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const vaultUnlocked = useVaultStore((s) => s.unlocked);
  const setVaultUnlocked = useVaultStore((s) => s.setUnlocked);
  const checkVaultStatus = useVaultStore((s) => s.checkStatus);
  const setPreference = useUiPreferencesStore((s) => s.set);
  const uiZoomLevel = useUiPreferencesStore((s) => s.uiZoomLevel);
  const keychainEnabled = useFeatureFlagsStore((s) => s.keychainEnabled);
  const userId = useAuthStore((s) => s.user?.id);
  const user = useAuthStore((s) => s.user);
  const secrets = useSecretStore((s) => s.secrets);
  const databaseProxyEnabled = useFeatureFlagsStore((s) => s.databaseProxyEnabled);
  const connectionsEnabled = useFeatureFlagsStore((s) => s.connectionsEnabled);
  const zeroTrustEnabled = useFeatureFlagsStore((s) => s.zeroTrustEnabled);
  const agenticAIEnabled = useFeatureFlagsStore((s) => s.agenticAIEnabled);
  const enterpriseAuthEnabled = useFeatureFlagsStore((s) => s.enterpriseAuthEnabled);

  const allConnections = useMemo(
    () => [...ownConnections, ...sharedConnections, ...teamConnections],
    [ownConnections, sharedConnections, teamConnections],
  );

  const recentConnections = useMemo(() => {
    if (!userId) return [];
    const recentIds = getRecentConnectionIds(userId);
    const connMap = new Map(allConnections.map((c) => [c.id, c]));
    return recentIds
      .map((id) => connMap.get(id))
      .filter((c): c is ConnectionData => c !== undefined)
      .slice(0, 5);
  }, [allConnections, userId]);

  const settingsConcerns = useMemo(() => {
    const hasTenant = !!user?.tenantId;
    const isAdmin = user?.tenantRole === 'ADMIN' || user?.tenantRole === 'OWNER';
    const isOwner = user?.tenantRole === 'OWNER';
    const noop = () => {};
    const ctx: SettingsConcernContext = {
      hasPassword: true,
      hasTenant,
      isAdmin,
      isOwner,
      anyConnectionFeature: connectionsEnabled || databaseProxyEnabled,
      connectionsEnabled,
      databaseProxyEnabled,
      keychainEnabled,
      zeroTrustEnabled,
      agenticAIEnabled,
      enterpriseAuthEnabled,
      linkedProvider: null,
      tenantId: user?.tenantId ?? null,
      onHasPasswordResolved: noop,
      deleteOrgTrigger: null,
      setDeleteOrgTrigger: noop,
      navigateToConcern: noop,
    };
    return buildSettingsConcerns(ctx);
  }, [
    user?.tenantId,
    user?.tenantRole,
    connectionsEnabled,
    databaseProxyEnabled,
    keychainEnabled,
    zeroTrustEnabled,
    agenticAIEnabled,
    enterpriseAuthEnabled,
  ]);

  const handleSelect = (callback: () => void) => {
    setOpen(false);
    callback();
  };

  const setConnectionFilter = (filter: ConnectionFilter) => {
    setPreference('workspaceActiveView', filter);
  };

  const handleLockVault = async () => {
    setVaultUnlocked(false);
    broadcastVaultWindowSync('lock');
    try {
      await lockVault();
    } catch {
      await checkVaultStatus();
    }
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command Palette"
      description="Search connections, actions, and settings"
    >
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {/* Recent connections */}
        {recentConnections.length > 0 ? (
          <CommandGroup heading="Recent">
            {recentConnections.map((conn) => (
              <CommandItem
                key={`recent-${conn.id}`}
                value={`recent ${conn.name} ${conn.host || ''}`}
                onSelect={() => handleSelect(() => openTab(conn))}
              >
                {connectionIcon(conn.type)}
                <span>{conn.name}</span>
                <CommandShortcut>{conn.type}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        <CommandSeparator />

        {/* All connections */}
        <CommandGroup heading="Connect to...">
          {allConnections.slice(0, 50).map((conn) => (
            <CommandItem
              key={conn.id}
              value={`connect ${conn.name} ${conn.host || ''} ${conn.type}`}
              onSelect={() => handleSelect(() => openTab(conn))}
            >
              {connectionIcon(conn.type)}
              <span>{conn.name}</span>
              <CommandShortcut>{conn.type}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>

        {/* Vault secrets */}
        {keychainEnabled && vaultUnlocked && secrets.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Secrets">
              {secrets.slice(0, 30).map((secret) => (
                <CommandItem
                  key={`secret-${secret.id}`}
                  value={`secret ${secret.name} ${secret.type} ${SECRET_TYPE_LABELS[secret.type]}`}
                  onSelect={() => handleSelect(onOpenKeychain)}
                >
                  {SECRET_TYPE_ICONS[secret.type]}
                  <span>{secret.name}</span>
                  <CommandShortcut>{SECRET_TYPE_LABELS[secret.type]}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        {/* Open tabs */}
        {tabs.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Switch Tab">
              {tabs.map((tab) => (
                <CommandItem
                  key={tab.id}
                  value={`tab ${tab.connection.name}`}
                  onSelect={() => handleSelect(() => setActiveTab(tab.id))}
                >
                  {connectionIcon(tab.connection.type)}
                  <span>{tab.connection.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        <CommandSeparator />

        {/* Navigate */}
        <CommandGroup heading="Navigate">
          <CommandItem
            value="navigate remote control ssh rdp vnc"
            onSelect={() => handleSelect(() => setConnectionFilter('remote'))}
          >
            <TerminalSquare className="size-4" />
            <span>Remote Control</span>
            <CommandShortcut>\u2318 1</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="navigate database proxy"
            onSelect={() => handleSelect(() => setConnectionFilter('database'))}
          >
            <DatabaseZap className="size-4" />
            <span>Database Proxy</span>
            <CommandShortcut>\u2318 2</CommandShortcut>
          </CommandItem>
          {keychainEnabled ? (
            <CommandItem
              value="navigate vault keychain secrets"
              onSelect={() => handleSelect(onOpenKeychain)}
            >
              <KeyRound className="size-4" />
              <span>Vault / Keychain</span>
            </CommandItem>
          ) : null}
          <CommandItem
            value="navigate audit activity log"
            onSelect={() => handleSelect(onOpenAuditLog)}
          >
            <History className="size-4" />
            <span>Activity Log</span>
          </CommandItem>
          <CommandItem
            value="navigate sessions recordings"
            onSelect={() => handleSelect(onOpenSessions)}
          >
            <Activity className="size-4" />
            <span>Sessions</span>
          </CommandItem>
          <CommandItem
            value="navigate settings preferences"
            onSelect={() => handleSelect(() => onOpenSettings())}
          >
            <Settings2 className="size-4" />
            <span>Settings</span>
          </CommandItem>
        </CommandGroup>

        {/* Settings sections */}
        {settingsConcerns.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Settings">
              {settingsConcerns.flatMap((concern) =>
                concern.sections.map((section) => (
                  <CommandItem
                    key={`setting-${concern.id}-${section.id}`}
                    value={`settings ${concern.label} ${section.label} ${section.keywords.join(' ')} ${concern.keywords.join(' ')}`}
                    onSelect={() => handleSelect(() => onOpenSettings(concern.id))}
                  >
                    {concern.icon}
                    <span>
                      {concern.label} &rsaquo; {section.label}
                    </span>
                    <CommandShortcut>{section.description}</CommandShortcut>
                  </CommandItem>
                )),
              )}
            </CommandGroup>
          </>
        ) : null}

        <CommandSeparator />

        {/* Actions */}
        <CommandGroup heading="Actions">
          <CommandItem
            value="action new connection create"
            onSelect={() => handleSelect(onCreateConnection)}
          >
            <Plus className="size-4" />
            <span>New Connection</span>
            <CommandShortcut>\u2318 T</CommandShortcut>
          </CommandItem>
          {keychainEnabled ? (
            <CommandItem
              value="action open keychain vault secrets"
              onSelect={() => handleSelect(onOpenKeychain)}
            >
              <KeyRound className="size-4" />
              <span>Open Keychain</span>
            </CommandItem>
          ) : null}
          <CommandItem
            value="action open audit activity log"
            onSelect={() => handleSelect(onOpenAuditLog)}
          >
            <History className="size-4" />
            <span>Open Activity Log</span>
          </CommandItem>
          <CommandItem
            value="action open sessions recordings"
            onSelect={() => handleSelect(onOpenSessions)}
          >
            <Activity className="size-4" />
            <span>Open Sessions</span>
          </CommandItem>
          {keychainEnabled && vaultUnlocked ? (
            <CommandItem
              value="action lock vault"
              onSelect={() => handleSelect(() => void handleLockVault())}
            >
              <Lock className="size-4" />
              <span>Lock Vault</span>
              <CommandShortcut>\u2318 L</CommandShortcut>
            </CommandItem>
          ) : null}
          <CommandItem
            value="action toggle theme dark light mode"
            onSelect={() => handleSelect(toggleTheme)}
          >
            {themeMode === 'dark' ? <SunMedium className="size-4" /> : <MoonStar className="size-4" />}
            <span>Toggle Theme</span>
          </CommandItem>
          <CommandItem
            value="action open settings preferences"
            onSelect={() => handleSelect(() => onOpenSettings())}
          >
            <Settings2 className="size-4" />
            <span>Open Settings</span>
          </CommandItem>
          <CommandItem
            value="action zoom in increase text size"
            onSelect={() => handleSelect(() => setPreference('uiZoomLevel', Math.min(150, uiZoomLevel + 10)))}
          >
            <ZoomIn className="size-4" />
            <span>Zoom In</span>
            <CommandShortcut>{'\u2318 +'}</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="action zoom out decrease text size"
            onSelect={() => handleSelect(() => setPreference('uiZoomLevel', Math.max(80, uiZoomLevel - 10)))}
          >
            <ZoomOut className="size-4" />
            <span>Zoom Out</span>
            <CommandShortcut>{'\u2318 \u2212'}</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="action reset zoom default text size"
            onSelect={() => handleSelect(() => setPreference('uiZoomLevel', 100))}
          >
            <RotateCcw className="size-4" />
            <span>Reset Zoom</span>
            <CommandShortcut>{'\u2318 0'}</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
