import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UiPreferences {
  rdpFileBrowserOpen: boolean;
  sshSftpBrowserOpen: boolean;
  sshSftpTransferQueueOpen: boolean;
  sidebarFavoritesOpen: boolean;
  sidebarRecentsOpen: boolean;
  sidebarSharedOpen: boolean;
  sidebarCompact: boolean;
  sidebarTeamSections: Record<string, boolean>;
  settingsActiveTab: string;
  keychainScopeFilter: string;
  keychainTypeFilter: string;
  keychainSortBy: string;
  orchestrationDashboardTab: string;
  orchestrationAutoRefresh: boolean;
  orchestrationRefreshInterval: number;
  gatewayActiveSubTab: string;
  auditLogAction: string;
  auditLogSearch: string;
  auditLogTargetType: string;
  auditLogGatewayId: string;
  auditLogSortBy: string;
  auditLogSortOrder: string;
  tenantAuditLogAction: string;
  tenantAuditLogSearch: string;
  tenantAuditLogTargetType: string;
  tenantAuditLogGatewayId: string;
  tenantAuditLogUserId: string;
  tenantAuditLogSortBy: string;
  tenantAuditLogSortOrder: string;
  tenantAuditLogViewMode: string;
  connAuditLogAction: string;
  connAuditLogSearch: string;
  connAuditLogGatewayId: string;
  connAuditLogUserId: string;
  connAuditLogSortBy: string;
  connAuditLogSortOrder: string;
  auditLogAutoRefreshPaused: boolean;
  auditLogDialogTab: string;
  lastActiveTenantId: string;
  keychainTreeOpen: boolean;
  keychainFolderExpandState: Record<string, boolean>;
  toolbarDockedSide: 'left' | 'right';
  toolbarDockedY: number;
  tunnelSectionOpen: boolean;
  tunnelEventLogOpen: boolean;
  tunnelDeployGuidesOpen: boolean;
  tunnelMetricsOpen: boolean;
  desktopNotificationsEnabled: boolean;
  dbSchemaBrowserOpen: boolean;
  queryVisualizerOpen: boolean;
}

interface UiPreferencesState extends UiPreferences {
  set: <K extends keyof UiPreferences>(key: K, value: UiPreferences[K]) => void;
  toggle: (key: { [K in keyof UiPreferences]: UiPreferences[K] extends boolean ? K : never }[keyof UiPreferences]) => void;
  toggleTeamSection: (teamId: string) => void;
  toggleKeychainFolder: (folderId: string) => void;
}

const defaults: UiPreferences = {
  rdpFileBrowserOpen: false,
  sshSftpBrowserOpen: false,
  sshSftpTransferQueueOpen: true,
  sidebarFavoritesOpen: true,
  sidebarRecentsOpen: true,
  sidebarSharedOpen: true,
  sidebarCompact: false,
  sidebarTeamSections: {},
  settingsActiveTab: 'profile',
  keychainScopeFilter: 'ALL',
  keychainTypeFilter: 'ALL',
  keychainSortBy: 'name',
  orchestrationDashboardTab: 'sessions',
  orchestrationAutoRefresh: true,
  orchestrationRefreshInterval: 10000,
  gatewayActiveSubTab: 'gateways',
  auditLogAction: '',
  auditLogSearch: '',
  auditLogTargetType: '',
  auditLogGatewayId: '',
  auditLogSortBy: 'createdAt',
  auditLogSortOrder: 'desc',
  tenantAuditLogAction: '',
  tenantAuditLogSearch: '',
  tenantAuditLogTargetType: '',
  tenantAuditLogGatewayId: '',
  tenantAuditLogUserId: '',
  tenantAuditLogSortBy: 'createdAt',
  tenantAuditLogSortOrder: 'desc',
  tenantAuditLogViewMode: 'table',
  connAuditLogAction: '',
  connAuditLogSearch: '',
  connAuditLogGatewayId: '',
  connAuditLogUserId: '',
  connAuditLogSortBy: 'createdAt',
  connAuditLogSortOrder: 'desc',
  auditLogAutoRefreshPaused: false,
  auditLogDialogTab: 'general',
  lastActiveTenantId: '',
  keychainTreeOpen: true,
  keychainFolderExpandState: {},
  toolbarDockedSide: 'left',
  toolbarDockedY: 50,
  tunnelSectionOpen: false,
  tunnelEventLogOpen: false,
  tunnelDeployGuidesOpen: false,
  tunnelMetricsOpen: true,
  desktopNotificationsEnabled: false,
  dbSchemaBrowserOpen: false,
  queryVisualizerOpen: false,
};

export const useUiPreferencesStore = create<UiPreferencesState>()(
  persist(
    (set) => ({
      ...defaults,
      set: (key, value) => set({ [key]: value }),
      toggle: (key) =>
        set((state) => ({ [key]: !state[key] })),
      toggleTeamSection: (teamId) =>
        set((state) => ({
          sidebarTeamSections: {
            ...state.sidebarTeamSections,
            [teamId]: !(state.sidebarTeamSections[teamId] ?? true),
          },
        })),
      toggleKeychainFolder: (folderId) =>
        set((state) => ({
          keychainFolderExpandState: {
            ...state.keychainFolderExpandState,
            [folderId]: !(state.keychainFolderExpandState[folderId] ?? true),
          },
        })),
    }),
    { name: 'arsenale-ui-preferences' },
  ),
);
