import { create } from 'zustand';
import {
  listSecrets,
  getSecret,
  createSecret as apiCreateSecret,
  updateSecret as apiUpdateSecret,
  deleteSecret as apiDeleteSecret,
  getTenantVaultStatus,
  initTenantVault as apiInitTenantVault,
  checkSecretBreach as apiCheckSecretBreach,
  checkAllSecretBreaches as apiCheckAllBreaches,
} from '../api/secrets.api';
import type {
  SecretListItem,
  SecretDetail,
  SecretListFilters,
  CreateSecretInput,
  UpdateSecretInput,
  TenantVaultStatus,
  BatchBreachCheckResult,
} from '../api/secrets.api';
import { listVaultFolders } from '../api/vault-folders.api';
import type { VaultFolderData } from '../api/vault-folders.api';

interface SecretState {
  secrets: SecretListItem[];
  selectedSecret: SecretDetail | null;
  loading: boolean;
  error: string | null;
  filters: SecretListFilters;
  tenantVaultStatus: TenantVaultStatus | null;
  expiringCount: number;
  pwnedCount: number;

  // Vault folders
  vaultFolders: VaultFolderData[];
  vaultTeamFolders: VaultFolderData[];
  vaultTenantFolders: VaultFolderData[];
  selectedFolderId: string | null;

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
  fetchExpiringCount: () => Promise<void>;
  fetchPwnedCount: () => Promise<void>;
  checkSecretBreach: (secretId: string) => Promise<number>;
  checkAllBreaches: () => Promise<BatchBreachCheckResult>;

  // Vault folder actions
  fetchVaultFolders: () => Promise<void>;
  setSelectedFolderId: (folderId: string | null) => void;
  moveSecret: (secretId: string, folderId: string | null) => Promise<void>;
}

export const useSecretStore = create<SecretState>((set, get) => ({
  secrets: [],
  selectedSecret: null,
  loading: false,
  error: null,
  filters: {},
  tenantVaultStatus: null,
  expiringCount: 0,
  pwnedCount: 0,

  // Vault folders
  vaultFolders: [],
  vaultTeamFolders: [],
  vaultTenantFolders: [],
  selectedFolderId: null,

  fetchSecrets: async () => {
    set({ loading: true, error: null });
    try {
      const { filters, selectedFolderId } = get();
      const effectiveFilters = { ...filters };
      if (selectedFolderId !== null) {
        effectiveFilters.folderId = selectedFolderId;
      }
      const secrets = await listSecrets(effectiveFilters);
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

  fetchExpiringCount: async () => {
    try {
      const allSecrets = await listSecrets({});
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const count = allSecrets.filter((s) => {
        if (!s.expiresAt) return false;
        const diff = new Date(s.expiresAt).getTime() - now;
        return diff <= sevenDays;
      }).length;
      set({ expiringCount: count });
    } catch {
      // ignore — vault may be locked
    }
  },

  fetchPwnedCount: async () => {
    try {
      const allSecrets = await listSecrets({});
      const count = allSecrets.filter((s) => s.pwnedCount > 0).length;
      set({ pwnedCount: count });
    } catch {
      // ignore — vault may be locked
    }
  },

  checkSecretBreach: async (secretId: string) => {
    const result = await apiCheckSecretBreach(secretId);
    // Update the secret in the list
    set((state) => ({
      secrets: state.secrets.map((s) =>
        s.id === secretId ? { ...s, pwnedCount: result.pwnedCount } : s,
      ),
      selectedSecret:
        state.selectedSecret?.id === secretId
          ? { ...state.selectedSecret, pwnedCount: result.pwnedCount }
          : state.selectedSecret,
    }));
    return result.pwnedCount;
  },

  checkAllBreaches: async () => {
    const result = await apiCheckAllBreaches();
    // Refresh list to get updated pwnedCount values
    await get().fetchSecrets();
    set({ pwnedCount: result.pwned });
    return result;
  },

  // Vault folder actions
  fetchVaultFolders: async () => {
    try {
      const result = await listVaultFolders();
      set({
        vaultFolders: result.personal,
        vaultTeamFolders: result.team,
        vaultTenantFolders: result.tenant,
      });
    } catch {
      // ignore — vault may be locked
    }
  },

  setSelectedFolderId: (folderId: string | null) => {
    set({ selectedFolderId: folderId });
    get().fetchSecrets();
  },

  moveSecret: async (secretId: string, folderId: string | null) => {
    await apiUpdateSecret(secretId, { folderId });
    const { selectedSecret } = get();
    if (selectedSecret?.id === secretId) {
      await get().fetchSecret(secretId);
    }
    await get().fetchSecrets();
  },
}));
