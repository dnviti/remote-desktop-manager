import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ThemeMode } from '../theme';

interface ThemeState {
  mode: ThemeMode;
  toggle: () => void;
}

const getSystemPreference = (): ThemeMode =>
  window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mode: getSystemPreference(),
      toggle: () =>
        set((state) => ({ mode: state.mode === 'dark' ? 'light' : 'dark' })),
    }),
    { name: 'arsenale-theme' }
  )
);
