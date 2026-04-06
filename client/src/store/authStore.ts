import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getCurrentUserPermissions, getDomainProfile } from '../api/user.api';
import { emptyPermissionFlags, type PermissionFlag } from '../utils/permissionFlags';
import { useVaultStore } from './vaultStore';

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
  permissions: Record<PermissionFlag, boolean>;
  permissionsLoaded: boolean;
  permissionsLoading: boolean;
  permissionsSubject: string | null;
  setAuth: (accessToken: string, csrfToken: string, user: User) => void;
  setAccessToken: (token: string) => void;
  setCsrfToken: (token: string) => void;
  updateUser: (data: Partial<User>) => void;
  fetchCurrentPermissions: () => Promise<void>;
  clearPermissions: () => void;
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
      permissions: emptyPermissionFlags(),
      permissionsLoaded: false,
      permissionsLoading: false,
      permissionsSubject: null,
      setAuth: (accessToken, csrfToken, user) => {
        useVaultStore.getState().reset();
        set({
          accessToken,
          csrfToken,
          user,
          isAuthenticated: true,
          permissions: emptyPermissionFlags(),
          permissionsLoaded: false,
          permissionsLoading: false,
          permissionsSubject: null,
        });
      },
      setAccessToken: (accessToken) => set({ accessToken }),
      setCsrfToken: (csrfToken) => set({ csrfToken }),
      updateUser: (data) => {
        const current = get().user;
        if (!current) return;
        const next = { ...current, ...data };
        const identityChanged = current.id !== next.id || current.tenantId !== next.tenantId;
        set({
          user: next,
          ...(identityChanged
            ? {
                permissions: emptyPermissionFlags(),
                permissionsLoaded: false,
                permissionsLoading: false,
                permissionsSubject: null,
              }
            : {}),
        });
      },
      fetchCurrentPermissions: async () => {
        const current = get().user;
        const subject = current?.id && current?.tenantId ? `${current.id}:${current.tenantId}` : null;
        if (!subject) {
          set({
            permissions: emptyPermissionFlags(),
            permissionsLoaded: false,
            permissionsLoading: false,
            permissionsSubject: null,
          });
          return;
        }

        const state = get();
        if (state.permissionsSubject === subject && (state.permissionsLoaded || state.permissionsLoading)) {
          return;
        }

        set({
          permissions: emptyPermissionFlags(),
          permissionsLoaded: false,
          permissionsLoading: true,
          permissionsSubject: subject,
        });

        try {
          const result = await getCurrentUserPermissions();
          if (get().permissionsSubject !== subject) return;
          set({
            permissions: { ...emptyPermissionFlags(), ...result.permissions },
            permissionsLoaded: true,
            permissionsLoading: false,
            permissionsSubject: subject,
          });
        } catch {
          if (get().permissionsSubject !== subject) return;
          set({
            permissions: emptyPermissionFlags(),
            permissionsLoaded: true,
            permissionsLoading: false,
            permissionsSubject: subject,
          });
        }
      },
      clearPermissions: () =>
        set({
          permissions: emptyPermissionFlags(),
          permissionsLoaded: false,
          permissionsLoading: false,
          permissionsSubject: null,
        }),
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
        {
          useVaultStore.getState().reset();
          set({
            accessToken: null,
            csrfToken: null,
            user: null,
            isAuthenticated: false,
            permissions: emptyPermissionFlags(),
            permissionsLoaded: false,
            permissionsLoading: false,
            permissionsSubject: null,
          });
        },
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
