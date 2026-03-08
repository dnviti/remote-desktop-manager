import { create } from 'zustand';
import type { SshTerminalConfig } from '../constants/terminalThemes';
import { getProfile, updateSshDefaults as apiUpdateSshDefaults } from '../api/user.api';

interface TerminalSettingsState {
  userDefaults: Partial<SshTerminalConfig> | null;
  loaded: boolean;
  loading: boolean;
  fetchDefaults: () => Promise<void>;
  updateDefaults: (config: Partial<SshTerminalConfig>) => Promise<void>;
}

export const useTerminalSettingsStore = create<TerminalSettingsState>((set) => ({
  userDefaults: null,
  loaded: false,
  loading: false,

  fetchDefaults: async () => {
    set({ loading: true });
    try {
      const profile = await getProfile();
      set({ userDefaults: profile.sshDefaults ?? null, loaded: true, loading: false });
    } catch {
      set({ loaded: true, loading: false });
    }
  },

  updateDefaults: async (config) => {
    set({ loading: true });
    try {
      console.log('[SSH save] sending config:', JSON.stringify(config));
      const result = await apiUpdateSshDefaults(config);
      console.log('[SSH save] server returned:', JSON.stringify(result.sshDefaults));
      set({ userDefaults: result.sshDefaults, loading: false });
    } catch {
      set({ loading: false });
      throw new Error('Failed to save SSH defaults');
    }
  },
}));
