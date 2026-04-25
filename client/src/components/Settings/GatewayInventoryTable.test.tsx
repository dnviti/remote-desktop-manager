import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GatewayData } from '../../api/gateway.api';
import GatewayInventoryTable from './GatewayInventoryTable';

vi.mock('../orchestration/ScalingControls', () => ({
  default: () => <div>Scaling controls</div>,
}));

vi.mock('../orchestration/GatewayInstanceList', () => ({
  default: () => <div>Gateway instances</div>,
}));

function buildGateway(overrides: Partial<GatewayData> = {}): GatewayData {
  return {
    id: 'gateway-1',
    name: 'Tunnel SSH',
    type: 'MANAGED_SSH',
    host: 'ssh-gateway',
    port: 2222,
    deploymentMode: 'MANAGED_GROUP',
    description: 'Primary managed SSH route.',
    isDefault: false,
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
    ...overrides,
  };
}

function GatewayInventoryHarness({
  gateways,
  pushStates = {},
  sshKeyReady = true,
  onDeleteGateway = vi.fn(),
  onEditGateway = vi.fn(),
  onPushKey = vi.fn(),
  onTestGateway = vi.fn(),
}: {
  gateways: GatewayData[];
  pushStates?: Record<string, { loading: boolean; result?: { ok: boolean; error?: string } }>;
  sshKeyReady?: boolean;
  onDeleteGateway?: (gateway: GatewayData) => void;
  onEditGateway?: (gateway: GatewayData) => void;
  onPushKey?: (gateway: GatewayData) => void;
  onTestGateway?: (gateway: GatewayData) => void;
}) {
  const [expandedGatewayIds, setExpandedGatewayIds] = useState<Set<string>>(new Set());

  return (
    <GatewayInventoryTable
      expandedGatewayIds={expandedGatewayIds}
      gateways={gateways}
      loading={false}
      pushStates={pushStates}
      sshKeyReady={sshKeyReady}
      testStates={{}}
      tunnelStatuses={{}}
      onCreateGateway={vi.fn()}
      onDeleteGateway={onDeleteGateway}
      onEditGateway={onEditGateway}
      onExpandedChange={(gatewayId, expanded) => {
        setExpandedGatewayIds((previous) => {
          const next = new Set(previous);
          if (expanded) next.add(gatewayId);
          else next.delete(gatewayId);
          return next;
        });
      }}
      onPushKey={onPushKey}
      onTestGateway={onTestGateway}
    />
  );
}

describe('GatewayInventoryTable', () => {
  it('supports sorting and filtering in the gateway inventory table', () => {
    render(
      <GatewayInventoryHarness
        gateways={[
          buildGateway({ id: 'gateway-z', name: 'Zulu Bastion', type: 'SSH_BASTION', deploymentMode: 'SINGLE_INSTANCE', host: 'zulu.example.com', port: 22, isManaged: false, totalInstances: 0, healthyInstances: 0, runningInstances: 0, tunnelEnabled: false, tunnelConnected: false, tunnelConnectedAt: null, operationalStatus: 'UNKNOWN', operationalReason: 'No tunnel configured.' }),
          buildGateway({ id: 'gateway-a', name: 'Alpha Database Proxy', type: 'DB_PROXY', deploymentMode: 'SINGLE_INSTANCE', host: 'db-proxy.example.com', port: 5432, isManaged: false, totalInstances: 0, healthyInstances: 0, runningInstances: 0, tunnelEnabled: false, tunnelConnected: false, tunnelConnectedAt: null, operationalStatus: 'UNKNOWN', operationalReason: 'No tunnel configured.' }),
        ]}
      />,
    );

    const table = screen.getByRole('table', { name: 'Gateway inventory' });
    expect(screen.getByRole('columnheader', { name: 'Gateway' })).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByRole('columnheader', { name: 'Endpoint' })).toHaveAttribute('aria-sort', 'none');
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Alpha Database Proxy');

    fireEvent.click(within(screen.getByRole('columnheader', { name: 'Gateway' })).getByRole('button'));
    expect(screen.getByRole('columnheader', { name: 'Gateway' })).toHaveAttribute('aria-sort', 'descending');
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Zulu Bastion');

    fireEvent.change(screen.getByRole('textbox', { name: 'Filter gateways' }), {
      target: { value: 'db-proxy' },
    });

    expect(screen.getByText('Alpha Database Proxy')).toBeInTheDocument();
    expect(screen.queryByText('Zulu Bastion')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 2 gateways shown')).toBeInTheDocument();
  });

  it('exposes a horizontal scroll container for the gateway inventory table', () => {
    render(
      <GatewayInventoryHarness
        gateways={[buildGateway()]}
      />,
    );

    const table = screen.getByRole('table', { name: 'Gateway inventory' });
    const tableContainer = table.parentElement;
    const tableCardWrapper = tableContainer?.parentElement;
    const panel = screen.getByText('Gateway Inventory').closest('section');
    const panelContent = panel?.lastElementChild;

    expect(tableContainer).toHaveAttribute('data-slot', 'table-container');
    expect(tableContainer).toHaveClass('overflow-x-scroll');
    expect(tableContainer).toHaveClass('overscroll-x-contain');
    expect(tableContainer).toHaveClass('pb-2');
    expect(tableCardWrapper).toHaveClass('min-w-0');
    expect(tableCardWrapper).toHaveClass('w-full');
    expect(tableCardWrapper).toHaveClass('max-w-full');
    expect(panel).toHaveClass('min-w-0');
    expect(panel).toHaveClass('w-full');
    expect(panel).toHaveClass('max-w-full');
    expect(panelContent).toHaveClass('min-w-0');
    expect(panelContent).toHaveClass('w-full');
    expect(panelContent).toHaveClass('max-w-full');
  });

  it('keeps row expansion and action menu behaviors available', async () => {
    const onDeleteGateway = vi.fn();
    const onEditGateway = vi.fn();
    const onPushKey = vi.fn();
    const onTestGateway = vi.fn();

    render(
      <GatewayInventoryHarness
        gateways={[buildGateway()]}
        onDeleteGateway={onDeleteGateway}
        onEditGateway={onEditGateway}
        onPushKey={onPushKey}
        onTestGateway={onTestGateway}
      />,
    );

    const expandButton = screen.getByRole('button', { name: 'Show details for Tunnel SSH' });
    expect(expandButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(expandButton);

    const expandedRegion = screen.getByRole('region', { name: 'Tunnel SSH details' });
    expect(screen.getByRole('button', { name: 'Hide details for Tunnel SSH' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Hide details for Tunnel SSH' })).toHaveAttribute(
      'aria-controls',
      expandedRegion.id,
    );
    expect(screen.getByText('Managed group controls and instances')).toBeInTheDocument();
    expect(screen.getByText('Scaling controls')).toBeInTheDocument();
    expect(screen.getByText('Gateway instances')).toBeInTheDocument();

    const actionButton = screen.getByRole('button', { name: 'Open actions for Tunnel SSH' });

    fireEvent.pointerDown(actionButton);
    fireEvent.click(await screen.findByRole('menuitem', { name: /Test/i }));
    expect(onTestGateway).toHaveBeenCalledWith(expect.objectContaining({ id: 'gateway-1' }));

    fireEvent.pointerDown(actionButton);
    fireEvent.click(await screen.findByRole('menuitem', { name: /Push Key/i }));
    expect(onPushKey).toHaveBeenCalledWith(expect.objectContaining({ id: 'gateway-1' }));

    fireEvent.pointerDown(actionButton);
    fireEvent.click(await screen.findByRole('menuitem', { name: /Edit/i }));
    expect(onEditGateway).toHaveBeenCalledWith(expect.objectContaining({ id: 'gateway-1' }));

    fireEvent.pointerDown(actionButton);
    fireEvent.click(await screen.findByRole('menuitem', { name: /Delete/i }));
    expect(onDeleteGateway).toHaveBeenCalledWith(expect.objectContaining({ id: 'gateway-1' }));
  });

  it('shows inline push-key result messaging in the row', () => {
    render(
      <GatewayInventoryHarness
        gateways={[buildGateway()]}
        pushStates={{
          'gateway-1': {
            loading: false,
            result: { ok: true },
          },
        }}
      />,
    );

    expect(screen.getByText('SSH key pushed successfully.')).toBeInTheDocument();
  });
});
