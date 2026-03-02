import { create } from 'zustand';
import {
  listSecrets,
  getSecret,
  createSecret as apiCreateSecret,
  updateSecret as apiUpdateSecret,
  deleteSecret as apiDeleteSecret,
  getTenantVaultStatus,
  initTenantVault as apiInitTenantVault,
} from '../api/secrets.api';
import type {
  SecretListItem,
  SecretDetail,
  SecretListFilters,
  CreateSecretInput,
  UpdateSecretInput,
  TenantVaultStatus,
} from '../api/secrets.api';

interface SecretState {
  secrets: SecretListItem[];
  selectedSecret: SecretDetail | null;
  loading: boolean;
  error: string | null;
  filters: SecretListFilters;
  tenantVaultStatus: TenantVaultStatus | null;

  fetchSecrets: () => Promise<void>;
  fetchSecret: (id: string) => Promise<void>;
  createSecret: (input: CreateSecretInput) => Promise<void>;
  updateSecret: (id: string, input: UpdateSecretInput) => Promise<void>;
  deleteSecret: (id: string) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  setFilters: (filters: Partial<SecretListFilters>) => void;
  clearSelectedSecret: () => void;
  fetchTenantVaultStatus: () => Promise<void>;
  initTenantVault: () => Promise<void>;
}

export const useSecretStore = create<SecretState>((set, get) => ({
  secrets: [],
  selectedSecret: null,
  loading: false,
  error: null,
  filters: {},
  tenantVaultStatus: null,

  fetchSecrets: async () => {
    set({ loading: true, error: null });
    try {
      const secrets = await listSecrets(get().filters);
      set({ secrets, loading: false });
    } catch {
      set({ error: 'Failed to load secrets', loading: false });
    }
  },

  fetchSecret: async (id: string) => {
    try {
      const secret = await getSecret(id);
      set({ selectedSecret: secret });
    } catch {
      set({ error: 'Failed to load secret details' });
    }
  },

  createSecret: async (input: CreateSecretInput) => {
    await apiCreateSecret(input);
    await get().fetchSecrets();
  },

  updateSecret: async (id: string, input: UpdateSecretInput) => {
    await apiUpdateSecret(id, input);
    const { selectedSecret } = get();
    if (selectedSecret?.id === id) {
      await get().fetchSecret(id);
    }
    await get().fetchSecrets();
  },

  deleteSecret: async (id: string) => {
    await apiDeleteSecret(id);
    const { selectedSecret } = get();
    if (selectedSecret?.id === id) {
      set({ selectedSecret: null });
    }
    await get().fetchSecrets();
  },

  toggleFavorite: async (id: string) => {
    const secret = get().secrets.find((s) => s.id === id);
    if (!secret) return;
    await apiUpdateSecret(id, { isFavorite: !secret.isFavorite });
    // Optimistic update
    set((state) => ({
      secrets: state.secrets.map((s) =>
        s.id === id ? { ...s, isFavorite: !s.isFavorite } : s,
      ),
      selectedSecret:
        state.selectedSecret?.id === id
          ? { ...state.selectedSecret, isFavorite: !state.selectedSecret.isFavorite }
          : state.selectedSecret,
    }));
  },

  setFilters: (filters: Partial<SecretListFilters>) => {
    set((state) => ({ filters: { ...state.filters, ...filters } }));
    get().fetchSecrets();
  },

  clearSelectedSecret: () => set({ selectedSecret: null }),

  fetchTenantVaultStatus: async () => {
    try {
      const status = await getTenantVaultStatus();
      set({ tenantVaultStatus: status });
    } catch {
      // Not in a tenant or endpoint unavailable
      set({ tenantVaultStatus: null });
    }
  },

  initTenantVault: async () => {
    await apiInitTenantVault();
    await get().fetchTenantVaultStatus();
  },
}));
