import { create } from 'zustand';
import { getVaultStatus } from '../api/vault.api';

interface VaultState {
  unlocked: boolean;
  checkStatus: () => Promise<void>;
  setUnlocked: (unlocked: boolean) => void;
}

export const useVaultStore = create<VaultState>((set) => ({
  unlocked: false,

  checkStatus: async () => {
    try {
      const data = await getVaultStatus();
      set({ unlocked: data.unlocked });
    } catch {
      set({ unlocked: false });
    }
  },

  setUnlocked: (unlocked) => set({ unlocked }),
}));
