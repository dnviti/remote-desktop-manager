import { create } from 'zustand';
import type { EnforcedConnectionSettings } from '../api/tenant.api';
import {
  TenantData, TenantUser, TenantMembership, CreateUserData, CreateUserResult,
  getMyTenant, createTenant as createTenantApi,
  updateTenant as updateTenantApi, deleteTenant as deleteTenantApi,
  listTenantUsers, inviteUser as inviteUserApi,
  updateUserRole as updateUserRoleApi, removeUser as removeUserApi,
  createTenantUser, toggleUserEnabled as toggleUserEnabledApi,
  getMyTenants, switchTenant as switchTenantApi,
  updateMembershipExpiry as updateMembershipExpiryApi,
} from '../api/tenant.api';
import { useAuthStore } from './authStore';
import { useTabsStore } from './tabsStore';
import { useConnectionsStore } from './connectionsStore';
import type { TenantRole } from '../utils/roles';

interface TenantState {
  tenant: TenantData | null;
  users: TenantUser[];
  memberships: TenantMembership[];
  loading: boolean;
  usersLoading: boolean;

  fetchTenant: () => Promise<void>;
  fetchMemberships: () => Promise<void>;
  switchTenant: (tenantId: string) => Promise<void>;
  createTenant: (name: string) => Promise<TenantData>;
  updateTenant: (data: { name?: string; defaultSessionTimeoutSeconds?: number; maxConcurrentSessions?: number; absoluteSessionTimeoutSeconds?: number; mfaRequired?: boolean; vaultAutoLockMaxMinutes?: number | null; dlpDisableCopy?: boolean; dlpDisablePaste?: boolean; dlpDisableDownload?: boolean; dlpDisableUpload?: boolean; enforcedConnectionSettings?: EnforcedConnectionSettings | null; tunnelDefaultEnabled?: boolean; tunnelAutoTokenRotation?: boolean; tunnelTokenRotationDays?: number; tunnelRequireForRemote?: boolean; tunnelTokenMaxLifetimeDays?: number | null; tunnelAgentAllowedCidrs?: string[] }) => Promise<void>;
  deleteTenant: () => Promise<void>;
  fetchUsers: () => Promise<void>;
  inviteUser: (email: string, role: TenantRole, expiresAt?: string) => Promise<void>;
  updateUserRole: (userId: string, role: TenantRole) => Promise<void>;
  removeUser: (userId: string) => Promise<void>;
  createUser: (data: CreateUserData) => Promise<CreateUserResult>;
  toggleUserEnabled: (userId: string, enabled: boolean) => Promise<void>;
  updateMembershipExpiry: (userId: string, expiresAt: string | null) => Promise<void>;
  reset: () => void;
}

export const useTenantStore = create<TenantState>((set, get) => ({
  tenant: null,
  users: [],
  memberships: [],
  loading: false,
  usersLoading: false,

  fetchMemberships: async () => {
    try {
      const memberships = await getMyTenants();
      set({ memberships });
    } catch {
      set({ memberships: [] });
    }
  },

  switchTenant: async (tenantId) => {
    const { accessToken, csrfToken, user } = await switchTenantApi(tenantId);
    useAuthStore.getState().setAuth(accessToken, csrfToken, user);
    await useTabsStore.getState().clearAll();
    useConnectionsStore.getState().reset();
    await get().fetchTenant();
    await get().fetchMemberships();
    await useConnectionsStore.getState().fetchConnections();
  },

  fetchTenant: async () => {
    set({ loading: true });
    try {
      const tenant = await getMyTenant();
      set({ tenant, loading: false });
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404 || status === 403) {
        set({ tenant: null, loading: false });
      } else {
        set({ loading: false });
        throw err;
      }
    }
  },

  createTenant: async (name) => {
    const { tenant, accessToken, csrfToken, user } = await createTenantApi(name);
    set({ tenant });
    useAuthStore.getState().setAuth(accessToken, csrfToken, user);
    return tenant;
  },

  updateTenant: async (data) => {
    const { tenant } = get();
    if (!tenant) return;
    const updated = await updateTenantApi(tenant.id, data);
    set({ tenant: updated });
  },

  deleteTenant: async () => {
    const { tenant } = get();
    if (!tenant) return;
    await deleteTenantApi(tenant.id);
    set({ tenant: null, users: [] });
    useAuthStore.getState().updateUser({ tenantId: undefined, tenantRole: undefined });
  },

  fetchUsers: async () => {
    const { tenant } = get();
    if (!tenant) return;
    set({ usersLoading: true });
    try {
      const users = await listTenantUsers(tenant.id);
      set({ users, usersLoading: false });
    } catch {
      set({ usersLoading: false });
    }
  },

  inviteUser: async (email, role, expiresAt?) => {
    const { tenant } = get();
    if (!tenant) return;
    await inviteUserApi(tenant.id, email, role, expiresAt);
    await get().fetchUsers();
  },

  updateUserRole: async (userId, role) => {
    const { tenant } = get();
    if (!tenant) return;
    await updateUserRoleApi(tenant.id, userId, role);
    await get().fetchUsers();
  },

  removeUser: async (userId) => {
    const { tenant } = get();
    if (!tenant) return;
    await removeUserApi(tenant.id, userId);
    await get().fetchUsers();
  },

  createUser: async (data) => {
    const { tenant } = get();
    if (!tenant) throw new Error('No tenant');
    const result = await createTenantUser(tenant.id, data);
    await get().fetchUsers();
    return result;
  },

  toggleUserEnabled: async (userId, enabled) => {
    const { tenant } = get();
    if (!tenant) return;
    await toggleUserEnabledApi(tenant.id, userId, enabled);
    await get().fetchUsers();
  },

  updateMembershipExpiry: async (userId, expiresAt) => {
    const { tenant } = get();
    if (!tenant) return;
    await updateMembershipExpiryApi(tenant.id, userId, expiresAt);
    await get().fetchUsers();
  },

  reset: () => set({ tenant: null, users: [], memberships: [], loading: false, usersLoading: false }),
}));
