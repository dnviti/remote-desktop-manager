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
  connAuditLogAction: string;
  connAuditLogSearch: string;
  connAuditLogGatewayId: string;
  connAuditLogUserId: string;
  connAuditLogSortBy: string;
  connAuditLogSortOrder: string;
  lastActiveTenantId: string;
}

interface UiPreferencesState extends UiPreferences {
  set: <K extends keyof UiPreferences>(key: K, value: UiPreferences[K]) => void;
  toggle: (key: keyof Omit<UiPreferences, 'sidebarTeamSections' | 'settingsActiveTab' | 'keychainScopeFilter' | 'keychainTypeFilter' | 'keychainSortBy' | 'orchestrationDashboardTab' | 'orchestrationRefreshInterval' | 'gatewayActiveSubTab' | 'auditLogAction' | 'auditLogSearch' | 'auditLogTargetType' | 'auditLogGatewayId' | 'auditLogSortBy' | 'auditLogSortOrder' | 'tenantAuditLogAction' | 'tenantAuditLogSearch' | 'tenantAuditLogTargetType' | 'tenantAuditLogGatewayId' | 'tenantAuditLogUserId' | 'tenantAuditLogSortBy' | 'tenantAuditLogSortOrder' | 'connAuditLogAction' | 'connAuditLogSearch' | 'connAuditLogGatewayId' | 'connAuditLogUserId' | 'connAuditLogSortBy' | 'connAuditLogSortOrder'>) => void;
  toggleTeamSection: (teamId: string) => void;
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
  connAuditLogAction: '',
  connAuditLogSearch: '',
  connAuditLogGatewayId: '',
  connAuditLogUserId: '',
  connAuditLogSortBy: 'createdAt',
  connAuditLogSortOrder: 'desc',
  lastActiveTenantId: '',
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
    }),
    { name: 'arsenale-ui-preferences' },
  ),
);
