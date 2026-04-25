import { create } from 'zustand';
import { getVaultStatus, type VaultStatusResponse } from '../api/vault.api';

interface VaultState {
  unlocked: boolean;
  initialized: boolean;
  mfaUnlockAvailable: boolean;
  mfaUnlockMethods: string[];
  checkStatus: () => Promise<void>;
  applyStatus: (status: VaultStatusResponse) => void;
  setUnlocked: (unlocked: boolean) => void;
  reset: () => void;
  /** Handle a vault status event pushed via Socket.IO */
  handleSocketEvent: (data: { unlocked: boolean }) => void;
}

export const useVaultStore = create<VaultState>((set) => ({
  unlocked: false,
  initialized: false,
  mfaUnlockAvailable: false,
  mfaUnlockMethods: [],

  checkStatus: async () => {
    try {
      const data = await getVaultStatus();
      set({
        unlocked: data.unlocked,
        initialized: true,
        mfaUnlockAvailable: data.mfaUnlockAvailable ?? false,
        mfaUnlockMethods: data.mfaUnlockMethods ?? [],
      });
    } catch {
      set({ unlocked: false, initialized: true, mfaUnlockAvailable: false, mfaUnlockMethods: [] });
    }
  },

  applyStatus: (status) => {
    set({
      unlocked: status.unlocked,
      initialized: true,
      mfaUnlockAvailable: status.mfaUnlockAvailable ?? false,
      mfaUnlockMethods: status.mfaUnlockMethods ?? [],
    });
  },

  setUnlocked: (unlocked) => set({ unlocked, initialized: true }),

  reset: () => set({ unlocked: false, initialized: false, mfaUnlockAvailable: false, mfaUnlockMethods: [] }),

  handleSocketEvent: (data: { unlocked: boolean }) => {
    set({ unlocked: data.unlocked, initialized: true });
  },
}));
