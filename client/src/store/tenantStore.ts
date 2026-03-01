import { create } from 'zustand';
import {
  TenantData, TenantUser,
  getMyTenant, createTenant as createTenantApi,
  updateTenant as updateTenantApi, deleteTenant as deleteTenantApi,
  listTenantUsers, inviteUser as inviteUserApi,
  updateUserRole as updateUserRoleApi, removeUser as removeUserApi,
} from '../api/tenant.api';
import { useAuthStore } from './authStore';

interface TenantState {
  tenant: TenantData | null;
  users: TenantUser[];
  loading: boolean;
  usersLoading: boolean;

  fetchTenant: () => Promise<void>;
  createTenant: (name: string) => Promise<TenantData>;
  updateTenant: (data: { name?: string }) => Promise<void>;
  deleteTenant: () => Promise<void>;
  fetchUsers: () => Promise<void>;
  inviteUser: (email: string, role: 'ADMIN' | 'MEMBER') => Promise<void>;
  updateUserRole: (userId: string, role: 'OWNER' | 'ADMIN' | 'MEMBER') => Promise<void>;
  removeUser: (userId: string) => Promise<void>;
  reset: () => void;
}

export const useTenantStore = create<TenantState>((set, get) => ({
  tenant: null,
  users: [],
  loading: false,
  usersLoading: false,

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
    const { tenant, accessToken, refreshToken, user } = await createTenantApi(name);
    set({ tenant });
    useAuthStore.getState().setAuth(accessToken, refreshToken, user);
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

  inviteUser: async (email, role) => {
    const { tenant } = get();
    if (!tenant) return;
    await inviteUserApi(tenant.id, email, role);
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

  reset: () => set({ tenant: null, users: [], loading: false, usersLoading: false }),
}));
