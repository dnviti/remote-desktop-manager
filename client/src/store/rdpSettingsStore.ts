import { create } from 'zustand';
import type { RdpSettings } from '../constants/rdpDefaults';
import { getProfile, updateRdpDefaults as apiUpdateRdpDefaults } from '../api/user.api';

interface RdpSettingsState {
  userDefaults: Partial<RdpSettings> | null;
  loaded: boolean;
  loading: boolean;
  fetchDefaults: () => Promise<void>;
  updateDefaults: (config: Partial<RdpSettings>) => Promise<void>;
}

export const useRdpSettingsStore = create<RdpSettingsState>((set) => ({
  userDefaults: null,
  loaded: false,
  loading: false,

  fetchDefaults: async () => {
    set({ loading: true });
    try {
      const profile = await getProfile();
      set({ userDefaults: profile.rdpDefaults ?? null, loaded: true, loading: false });
    } catch {
      set({ loaded: true, loading: false });
    }
  },

  updateDefaults: async (config) => {
    set({ loading: true });
    try {
      const result = await apiUpdateRdpDefaults(config);
      set({ userDefaults: result.rdpDefaults, loading: false });
    } catch {
      set({ loading: false });
      throw new Error('Failed to save RDP defaults');
    }
  },
}));
