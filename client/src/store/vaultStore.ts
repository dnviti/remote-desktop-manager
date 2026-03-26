import { create } from 'zustand';
import { getVaultStatus } from '../api/vault.api';

const POLL_INTERVAL_MS = 60_000;

let pollTimer: ReturnType<typeof setInterval> | null = null;

interface VaultState {
  unlocked: boolean;
  initialized: boolean;
  mfaUnlockAvailable: boolean;
  mfaUnlockMethods: string[];
  checkStatus: () => Promise<void>;
  setUnlocked: (unlocked: boolean) => void;
  /** Handle a vault status event pushed via Socket.IO */
  handleSocketEvent: (data: { unlocked: boolean }) => void;
  startPolling: () => void;
  stopPolling: () => void;
}

export const useVaultStore = create<VaultState>((set, get) => ({
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

  setUnlocked: (unlocked) => set({ unlocked }),

  handleSocketEvent: (data: { unlocked: boolean }) => {
    set({ unlocked: data.unlocked, initialized: true });
  },

  startPolling: () => {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      get().checkStatus();
    }, POLL_INTERVAL_MS);
  },

  stopPolling: () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  },
}));
