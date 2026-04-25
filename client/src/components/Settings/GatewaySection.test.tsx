import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { useGatewayStore } from '../../store/gatewayStore';
import { useUiPreferencesStore } from '../../store/uiPreferencesStore';
import GatewaySection from './GatewaySection';

vi.mock('../gateway/GatewayDialog', () => ({
  default: () => <div data-testid="gateway-dialog" />,
}));

vi.mock('../gateway/GatewayTemplateSection', () => ({
  default: () => <div>Gateway templates</div>,
}));

vi.mock('../orchestration/SessionDashboard', () => ({
  default: () => <div>Session dashboard</div>,
}));

vi.mock('../orchestration/ScalingControls', () => ({
  default: () => <div>Scaling controls</div>,
}));

vi.mock('../orchestration/GatewayInstanceList', () => ({
  default: () => <div>Gateway instances</div>,
}));

describe('GatewaySection', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    useUiPreferencesStore.setState({
      gatewayActiveSubTab: 'gateways',
    });
  });

  it('shows an organization setup call to action when the user has no tenant', () => {
    useAuthStore.setState({
      user: {
        id: 'user-1',
        email: 'user@example.com',
        username: 'User',
        avatarData: null,
        tenantId: undefined,
        tenantRole: undefined,
      },
      permissionsLoaded: true,
      permissions: {
        ...useAuthStore.getState().permissions,
        canViewSessions: true,
        canObserveSessions: true,
        canControlSessions: true,
        canManageGateways: true,
        canManageSessions: true,
      },
    });

    render(
      <MemoryRouter>
        <GatewaySection />
      </MemoryRouter>,
    );

    expect(screen.getByText('Gateway access')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set Up Organization' })).toBeInTheDocument();
  });

  it('renders the shadcn gateway inventory and key management panels', async () => {
    useAuthStore.setState({
      user: {
        id: 'user-1',
        email: 'admin@example.com',
        username: 'Admin',
        avatarData: null,
        tenantId: 'tenant-1',
        tenantRole: 'OWNER',
      },
      permissionsLoaded: true,
      permissions: {
        ...useAuthStore.getState().permissions,
        canViewSessions: true,
        canObserveSessions: true,
        canControlSessions: true,
        canManageGateways: true,
        canManageSessions: true,
      },
    });

    useGatewayStore.setState({
      gateways: [
        {
          id: 'gateway-1',
          name: 'Tunnel SSH',
          type: 'MANAGED_SSH',
          host: 'ssh-gateway',
          port: 2222,
          deploymentMode: 'MANAGED_GROUP',
          description: 'Primary managed SSH route.',
          isDefault: true,
          hasSshKey: true,
          apiPort: 9022,
          inactivityTimeoutSeconds: 3600,
          tenantId: 'tenant-1',
          createdById: 'user-1',
          createdAt: '2026-04-08T00:00:00.000Z',
          updatedAt: '2026-04-08T00:00:00.000Z',
          monitoringEnabled: true,
          monitorIntervalMs: 5000,
          lastHealthStatus: 'REACHABLE',
          lastCheckedAt: '2026-04-08T00:00:00.000Z',
          lastLatencyMs: 24,
          lastError: null,
          isManaged: true,
          publishPorts: false,
          lbStrategy: 'ROUND_ROBIN',
          desiredReplicas: 1,
          autoScale: false,
          minReplicas: 1,
          maxReplicas: 3,
          sessionsPerInstance: 10,
          scaleDownCooldownSeconds: 300,
          lastScaleAction: null,
          templateId: null,
          totalInstances: 1,
          healthyInstances: 1,
          runningInstances: 1,
          tunnelEnabled: true,
          tunnelConnected: true,
          tunnelConnectedAt: '2026-04-08T00:00:00.000Z',
          tunnelClientCertExp: null,
          operationalStatus: 'HEALTHY',
          operationalReason: 'Tunnel is connected and reporting a healthy heartbeat.',
        },
        {
          id: 'gateway-2',
          name: 'Database Proxy',
          type: 'DB_PROXY',
          host: 'db-proxy.example.com',
          port: 5432,
          deploymentMode: 'SINGLE_INSTANCE',
          description: 'Primary database proxy route.',
          isDefault: false,
          hasSshKey: false,
          apiPort: null,
          inactivityTimeoutSeconds: 3600,
          tenantId: 'tenant-1',
          createdById: 'user-1',
          createdAt: '2026-04-08T00:00:00.000Z',
          updatedAt: '2026-04-08T00:00:00.000Z',
          monitoringEnabled: true,
          monitorIntervalMs: 5000,
          lastHealthStatus: 'REACHABLE',
          lastCheckedAt: '2026-04-08T00:00:00.000Z',
          lastLatencyMs: 11,
          lastError: null,
          isManaged: false,
          publishPorts: false,
          lbStrategy: 'ROUND_ROBIN',
          desiredReplicas: 0,
          autoScale: false,
          minReplicas: 0,
          maxReplicas: 1,
          sessionsPerInstance: 10,
          scaleDownCooldownSeconds: 300,
          lastScaleAction: null,
          templateId: null,
          totalInstances: 0,
          healthyInstances: 0,
          runningInstances: 0,
          tunnelEnabled: true,
          tunnelConnected: true,
          tunnelConnectedAt: '2026-04-08T00:00:00.000Z',
          tunnelClientCertExp: null,
          operationalStatus: 'HEALTHY',
          operationalReason: 'Tunnel is connected and forwarding database traffic.',
        },
      ],
      loading: false,
      sshKeyPair: {
        id: 'key-1',
        publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGatewayKey',
        fingerprint: 'SHA256:test',
        algorithm: 'ed25519',
        createdAt: '2026-04-08T00:00:00.000Z',
        updatedAt: '2026-04-08T00:00:00.000Z',
      },
      sshKeyLoading: false,
      tunnelStatuses: {
        'gateway-1': {
          gatewayId: 'gateway-1',
          connected: true,
          connectedAt: '2026-04-08T00:00:00.000Z',
          rttMs: 19,
          activeStreams: 2,
          agentVersion: '1.0.0',
          checkedAt: '2026-04-08T00:00:00.000Z',
        },
      },
      fetchGateways: vi.fn().mockResolvedValue(undefined),
      createGateway: vi.fn().mockResolvedValue(undefined),
      updateGateway: vi.fn().mockResolvedValue(undefined),
      deleteGateway: vi.fn().mockResolvedValue(undefined),
      applyHealthUpdate: vi.fn(),
      applyInstancesUpdate: vi.fn(),
      applyScalingUpdate: vi.fn(),
      applyGatewayUpdate: vi.fn(),
      applyGatewayStreamSnapshot: vi.fn(),
      applyActiveSessionStreamSnapshot: vi.fn(),
      fetchSshKeyPair: vi.fn().mockResolvedValue(undefined),
      generateSshKeyPair: vi.fn().mockResolvedValue(undefined),
      rotateSshKeyPair: vi.fn().mockResolvedValue({}),
      pushKeyToGateway: vi.fn().mockResolvedValue({ ok: true }),
      activeSessions: [],
      sessionCount: 0,
      sessionCountByGateway: [],
      scalingStatus: {},
      instances: {},
      sessionsLoading: false,
      fetchActiveSessions: vi.fn().mockResolvedValue(undefined),
      fetchSessionCount: vi.fn().mockResolvedValue(undefined),
      fetchSessionCountByGateway: vi.fn().mockResolvedValue(undefined),
      pauseSession: vi.fn().mockResolvedValue(undefined),
      resumeSession: vi.fn().mockResolvedValue(undefined),
      terminateSession: vi.fn().mockResolvedValue(undefined),
      fetchScalingStatus: vi.fn().mockResolvedValue(undefined),
      fetchInstances: vi.fn().mockResolvedValue(undefined),
      watchScalingStatus: vi.fn(),
      unwatchScalingStatus: vi.fn(),
      watchInstances: vi.fn(),
      unwatchInstances: vi.fn(),
      deployGateway: vi.fn().mockResolvedValue(undefined),
      undeployGateway: vi.fn().mockResolvedValue(undefined),
      scaleGateway: vi.fn().mockResolvedValue(undefined),
      updateScalingConfig: vi.fn().mockResolvedValue(undefined),
      restartInstance: vi.fn().mockResolvedValue(undefined),
      templates: [],
      templatesLoading: false,
      fetchTemplates: vi.fn().mockResolvedValue(undefined),
      createTemplate: vi.fn().mockResolvedValue(undefined),
      updateTemplate: vi.fn().mockResolvedValue(undefined),
      deleteTemplate: vi.fn().mockResolvedValue(undefined),
      deployFromTemplate: vi.fn().mockResolvedValue(undefined),
      generateTunnelToken: vi.fn().mockResolvedValue(undefined),
      revokeTunnelToken: vi.fn().mockResolvedValue(undefined),
      applyTunnelStatusUpdate: vi.fn(),
      tunnelOverview: null,
      tunnelOverviewLoading: false,
      fetchTunnelOverview: vi.fn().mockResolvedValue(undefined),
      watchedScalingGatewayIds: {},
      watchedInstanceGatewayIds: {},
      reset: vi.fn(),
    });

    render(
      <MemoryRouter>
        <GatewaySection />
      </MemoryRouter>,
    );

    expect(screen.getByText('SSH Key Pair')).toBeInTheDocument();
    expect(screen.getByText('Gateway Inventory')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Tunnel SSH')).toBeInTheDocument();
    expect(screen.getByText('Database Proxy')).toBeInTheDocument();
    expect(screen.getAllByText('Tunnel healthy')).toHaveLength(2);
    expect(screen.getByText('DB Proxy')).toBeInTheDocument();

    const gatewaysTabPanel = screen.getByText('Gateway Inventory').closest('[role="tabpanel"]');
    const tabsRoot = gatewaysTabPanel?.parentElement;

    expect(gatewaysTabPanel).toHaveClass('min-w-0');
    expect(gatewaysTabPanel).toHaveClass('w-full');
    expect(gatewaysTabPanel).toHaveClass('max-w-full');
    expect(tabsRoot).toHaveClass('min-w-0');
    expect(tabsRoot).toHaveClass('w-full');
    expect(tabsRoot).toHaveClass('max-w-full');

    fireEvent.click(screen.getByRole('button', { name: 'Show details for Tunnel SSH' }));
    expect(screen.getByText('Managed group controls and instances')).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Open actions for Tunnel SSH' }));
    expect(await screen.findByRole('menuitem', { name: /Push Key/i })).toBeInTheDocument();
  });

  it('allows session viewers to open Active Sessions without gateway management access', async () => {
    useUiPreferencesStore.setState({
      gatewayActiveSubTab: 'gateways',
    });

    useAuthStore.setState({
      user: {
        id: 'user-1',
        email: 'viewer@example.com',
        username: 'Viewer',
        avatarData: null,
        tenantId: 'tenant-1',
        tenantRole: 'AUDITOR',
      },
      permissionsLoaded: true,
      permissions: {
        ...useAuthStore.getState().permissions,
        canViewSessions: true,
        canObserveSessions: true,
        canControlSessions: false,
        canManageGateways: false,
        canManageSessions: false,
      },
    });

    const onOpenSessions = vi.fn();

    render(
      <MemoryRouter>
        <GatewaySection onOpenSessions={onOpenSessions} />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Session dashboard')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Sessions' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /open the sessions console/i }));
    expect(onOpenSessions).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('tab', { name: 'Gateways' })).not.toBeInTheDocument();
    expect(screen.queryByText('Gateway access is restricted')).not.toBeInTheDocument();
  });
});
