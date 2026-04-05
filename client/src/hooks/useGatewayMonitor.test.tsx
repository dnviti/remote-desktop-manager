import { renderHook } from '@testing-library/react';
import { useAuthStore } from '../store/authStore';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';
import { useGatewayStore } from '../store/gatewayStore';
import { useGatewayMonitor } from './useGatewayMonitor';
import { connectSSE } from '../api/sse';

vi.mock('../api/sse', () => ({
  connectSSE: vi.fn(() => vi.fn()),
}));

describe('useGatewayMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      accessToken: 'token',
      csrfToken: 'csrf',
      isAuthenticated: true,
      user: {
        id: 'user-1',
        email: 'user@example.com',
        username: 'user',
        avatarData: null,
        tenantId: 'tenant-1',
        tenantRole: 'OPERATOR',
      },
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
        canManageSessions: true,
        canManageGateways: false,
        canManageUsers: false,
        canManageSecrets: true,
        canManageTenantSettings: false,
      },
    });
    useGatewayStore.setState({
      watchedScalingGatewayIds: {},
      watchedInstanceGatewayIds: {},
    });
    useFeatureFlagsStore.setState({ loaded: true, zeroTrustEnabled: true });
  });

  it('does not connect when the current user cannot manage gateways', () => {
    renderHook(() => useGatewayMonitor());

    expect(connectSSE).not.toHaveBeenCalled();
  });

  it('does not connect when zeroTrustEnabled is false', () => {
    useAuthStore.setState((state) => ({
      ...state,
      permissions: {
        ...state.permissions,
        canManageGateways: true,
      },
    }));
    useFeatureFlagsStore.setState({ loaded: true, zeroTrustEnabled: false });

    renderHook(() => useGatewayMonitor());

    expect(connectSSE).not.toHaveBeenCalled();
  });

  it('connects when gateway management is allowed', async () => {
    useAuthStore.setState((state) => ({
      ...state,
      permissions: {
        ...state.permissions,
        canManageGateways: true,
      },
    }));

    renderHook(() => useGatewayMonitor());

    await vi.waitFor(() => {
      expect(connectSSE).toHaveBeenCalledWith(expect.objectContaining({
        url: '/api/gateways/stream',
        accessToken: 'token',
      }));
    });
  });
});
