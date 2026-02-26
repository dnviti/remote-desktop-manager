import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UiPreferences {
  rdpFileBrowserOpen: boolean;
  sshSftpBrowserOpen: boolean;
  sshSftpTransferQueueOpen: boolean;
}

interface UiPreferencesState extends UiPreferences {
  set: <K extends keyof UiPreferences>(key: K, value: UiPreferences[K]) => void;
  toggle: (key: keyof UiPreferences) => void;
}

const defaults: UiPreferences = {
  rdpFileBrowserOpen: false,
  sshSftpBrowserOpen: false,
  sshSftpTransferQueueOpen: true,
};

export const useUiPreferencesStore = create<UiPreferencesState>()(
  persist(
    (set) => ({
      ...defaults,
      set: (key, value) => set({ [key]: value }),
      toggle: (key) => set((state) => ({ [key]: !state[key] })),
    }),
    { name: 'rdm-ui-preferences' },
  ),
);
