import { getCurrentUserPermissions, getDomainProfile } from '../api/user.api';
import { emptyPermissionFlags } from '../utils/permissionFlags';
import { useAuthStore } from './authStore';

vi.mock('../api/user.api', () => ({
  getDomainProfile: vi.fn(),
  getCurrentUserPermissions: vi.fn(),
}));

const baseUser = {
  id: 'user-1',
  email: 'user@example.com',
  username: 'user',
  avatarData: null,
};

const tenantUser = {
  ...baseUser,
  tenantId: 'tenant-1',
  tenantRole: 'OPERATOR',
};

describe('useAuthStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({
      accessToken: null,
      csrfToken: null,
      user: null,
      isAuthenticated: false,
      permissions: emptyPermissionFlags(),
      permissionsLoaded: false,
      permissionsLoading: false,
      permissionsSubject: null,
    });
    vi.clearAllMocks();
  });

  it('stores runtime auth state and persists only the safe subset', () => {
    useAuthStore.getState().setAuth('access-token', 'csrf-token', baseUser);

    const persisted = JSON.parse(localStorage.getItem('arsenale-auth') ?? '{}');

    expect(useAuthStore.getState()).toMatchObject({
      accessToken: 'access-token',
      csrfToken: 'csrf-token',
      user: baseUser,
      isAuthenticated: true,
      permissionsLoaded: false,
    });
    expect(persisted.state).toMatchObject({
      user: baseUser,
      isAuthenticated: true,
    });
    expect(persisted.state.accessToken).toBeUndefined();
    expect(persisted.state.csrfToken).toBeUndefined();
    expect(persisted.state.permissions).toBeUndefined();
  });

  it('applies restored browser sessions without resetting permissions for the same identity', () => {
    useAuthStore.getState().setAuth('access-token', 'csrf-token', tenantUser);
    useAuthStore.setState({
      permissionsLoaded: true,
      permissionsLoading: false,
      permissionsSubject: 'user-1:tenant-1',
      permissions: {
        canConnect: true,
        canCreateConnections: true,
        canManageConnections: true,
        canViewCredentials: true,
        canShareConnections: true,
        canViewAuditLog: true,
        canViewSessions: true,
        canObserveSessions: true,
        canControlSessions: true,
        canManageSessions: true,
        canManageGateways: false,
        canManageUsers: false,
        canManageSecrets: true,
        canManageTenantSettings: false,
      },
    });

    useAuthStore.getState().applySession('restored-access-token', 'restored-csrf-token', tenantUser);

    expect(useAuthStore.getState()).toMatchObject({
      accessToken: 'restored-access-token',
      csrfToken: 'restored-csrf-token',
      permissionsLoaded: true,
      permissionsSubject: 'user-1:tenant-1',
    });
    expect(useAuthStore.getState().permissions.canManageSecrets).toBe(true);
  });

  it('merges partial user updates into the current profile', () => {
    useAuthStore.getState().setAuth('access-token', 'csrf-token', baseUser);

    useAuthStore.getState().updateUser({
      username: 'renamed-user',
      avatarData: 'avatar-data',
    });

    expect(useAuthStore.getState().user).toEqual({
      ...baseUser,
      username: 'renamed-user',
      avatarData: 'avatar-data',
    });
  });

  it('hydrates the optional domain profile fields when available', async () => {
    vi.mocked(getDomainProfile).mockResolvedValue({
      domainName: 'corp.example.com',
      domainUsername: 'CORP\\user',
      hasDomainPassword: true,
    });
    useAuthStore.getState().setAuth('access-token', 'csrf-token', baseUser);

    await useAuthStore.getState().fetchDomainProfile();

    expect(useAuthStore.getState().user).toMatchObject({
      ...baseUser,
      domainName: 'corp.example.com',
      domainUsername: 'CORP\\user',
      hasDomainPassword: true,
    });
  });

  it('loads effective permissions for the active tenant without persisting them', async () => {
    vi.mocked(getCurrentUserPermissions).mockResolvedValue({
      tenantId: 'tenant-1',
      role: 'OPERATOR',
      permissions: {
        canConnect: true,
        canCreateConnections: true,
        canManageConnections: true,
        canViewCredentials: true,
        canShareConnections: true,
        canViewAuditLog: true,
        canViewSessions: true,
        canObserveSessions: true,
        canControlSessions: true,
        canManageSessions: true,
        canManageGateways: false,
        canManageUsers: false,
        canManageSecrets: true,
        canManageTenantSettings: false,
      },
    });
    useAuthStore.getState().setAuth('access-token', 'csrf-token', tenantUser);

    await useAuthStore.getState().fetchCurrentPermissions();

    expect(useAuthStore.getState()).toMatchObject({
      permissionsLoaded: true,
      permissionsLoading: false,
      permissionsSubject: 'user-1:tenant-1',
    });
    expect(useAuthStore.getState().permissions.canManageGateways).toBe(false);
    expect(useAuthStore.getState().permissions.canViewSessions).toBe(true);
    expect(useAuthStore.getState().permissions.canControlSessions).toBe(true);

    const persisted = JSON.parse(localStorage.getItem('arsenale-auth') ?? '{}');
    expect(persisted.state.permissions).toBeUndefined();
  });

  it('ignores domain profile failures and clears the session on logout', async () => {
    vi.mocked(getDomainProfile).mockRejectedValue(new Error('boom'));
    useAuthStore.getState().setAuth('access-token', 'csrf-token', tenantUser);
    useAuthStore.setState({
      permissionsLoaded: true,
      permissionsLoading: false,
      permissionsSubject: 'user-1:tenant-1',
      permissions: {
        canConnect: true,
        canCreateConnections: true,
        canManageConnections: true,
        canViewCredentials: true,
        canShareConnections: true,
        canViewAuditLog: true,
        canViewSessions: true,
        canObserveSessions: true,
        canControlSessions: true,
        canManageSessions: true,
        canManageGateways: true,
        canManageUsers: true,
        canManageSecrets: true,
        canManageTenantSettings: false,
      },
    });

    await expect(useAuthStore.getState().fetchDomainProfile()).resolves.toBeUndefined();
    expect(useAuthStore.getState().accessToken).toBe('access-token');

    useAuthStore.getState().logout();

    expect(useAuthStore.getState()).toMatchObject({
      accessToken: null,
      csrfToken: null,
      user: null,
      isAuthenticated: false,
      permissionsLoaded: false,
      permissionsSubject: null,
    });
    expect(useAuthStore.getState().permissions.canManageGateways).toBe(false);
  });
});
