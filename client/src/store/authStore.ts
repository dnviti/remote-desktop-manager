import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getDomainProfile } from '../api/user.api';

interface User {
  id: string;
  email: string;
  username: string | null;
  avatarData: string | null;
  vaultSetupComplete?: boolean;
  tenantId?: string;
  tenantRole?: string;
  domainName?: string | null;
  domainUsername?: string | null;
  hasDomainPassword?: boolean;
}

interface AuthState {
  accessToken: string | null;
  csrfToken: string | null;
  user: User | null;
  isAuthenticated: boolean;
  setAuth: (accessToken: string, csrfToken: string, user: User) => void;
  setAccessToken: (token: string) => void;
  setCsrfToken: (token: string) => void;
  updateUser: (data: Partial<User>) => void;
  fetchDomainProfile: () => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      csrfToken: null,
      user: null,
      isAuthenticated: false,
      setAuth: (accessToken, csrfToken, user) =>
        set({ accessToken, csrfToken, user, isAuthenticated: true }),
      setAccessToken: (accessToken) => set({ accessToken }),
      setCsrfToken: (csrfToken) => set({ csrfToken }),
      updateUser: (data) => {
        const current = get().user;
        if (current) set({ user: { ...current, ...data } });
      },
      fetchDomainProfile: async () => {
        try {
          const profile = await getDomainProfile();
          const current = get().user;
          if (current) {
            set({
              user: {
                ...current,
                domainName: profile.domainName,
                domainUsername: profile.domainUsername,
                hasDomainPassword: profile.hasDomainPassword,
              },
            });
          }
        } catch {
          // Ignore errors — domain profile is optional
        }
      },
      logout: () =>
        set({
          accessToken: null,
          csrfToken: null,
          user: null,
          isAuthenticated: false,
        }),
    }),
    {
      name: 'arsenale-auth',
      partialize: (state) => ({
        // SECURITY: accessToken is deliberately excluded — it must remain
        // in-memory only to limit XSS exposure. Never persist it.
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        csrfToken: state.csrfToken,
      }),
    }
  )
);
