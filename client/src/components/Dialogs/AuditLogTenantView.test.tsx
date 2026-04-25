import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AuditLogTenantView from './AuditLogTenantView';

const auditGeoMapMock = vi.fn(({ onSelectCountry }: { onSelectCountry?: (country: string) => void }) => (
  <button type="button" onClick={() => onSelectCountry?.('United States')}>
    Mock geo map
  </button>
));

vi.mock('../Audit/AuditGeoMap', () => ({
  default: (props: { onSelectCountry?: (country: string) => void }) => auditGeoMapMock(props),
}));

describe('AuditLogTenantView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the same filters as the table for the map and keeps the map selected when filtering by country', async () => {
    const onCountryChange = vi.fn();
    const onViewModeChange = vi.fn();

    render(
      <AuditLogTenantView
        action="LOGIN"
        countries={['United States']}
        effectiveViewMode="map"
        endDate=""
        error=""
        expandedRowId={null}
        flaggedOnly={false}
        gatewayId="gateway-1"
        gateways={[{ id: 'gateway-1', name: 'Gateway 1' }]}
        geoCountry=""
        ipAddress="8.8.8"
        ipGeolocationEnabled
        loading={false}
        loadingRecordingId={null}
        onActionChange={vi.fn()}
        onClearFilters={vi.fn()}
        onCloseRecordingPlayer={vi.fn()}
        onCountryChange={onCountryChange}
        onEndDateChange={vi.fn()}
        onFlaggedToggle={vi.fn()}
        onGatewayChange={vi.fn()}
        onHandleSort={vi.fn()}
        onIpAddressChange={vi.fn()}
        onNextPage={vi.fn()}
        onPreviousPage={vi.fn()}
        onRowsPerPageChange={vi.fn()}
        onSearchChange={vi.fn()}
        onSortByChange={vi.fn()}
        onSortOrderChange={vi.fn()}
        onStartDateChange={vi.fn()}
        onTargetTypeChange={vi.fn()}
        onToggleRow={vi.fn()}
        onUserChange={vi.fn()}
        onViewModeChange={onViewModeChange}
        onViewRecording={vi.fn()}
        page={0}
        recordingPlayerOpen={false}
        rowsPerPage={25}
        search="ssh"
        searchInput="ssh"
        selectedRecording={null}
        sortBy="createdAt"
        sortOrder="desc"
        startDate=""
        targetType="Connection"
        tenantLogs={[]}
        total={0}
        userId="user-1"
        users={[{
          id: 'user-1',
          email: 'admin@example.com',
          username: 'Admin',
          avatarData: null,
          role: 'OWNER',
          status: 'ACCEPTED',
          pending: false,
          totpEnabled: true,
          smsMfaEnabled: false,
          enabled: true,
          createdAt: '2026-04-12T00:00:00.000Z',
          expiresAt: null,
          expired: false,
        }]}
      />,
    );

    expect(await screen.findByText(/same filtered geolocated activity shown in the table/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(auditGeoMapMock).toHaveBeenCalled();
    });

    const props = auditGeoMapMock.mock.calls[0]?.[0] as {
      countLabel: string;
      emptyMessage: string;
      filters: Record<string, unknown>;
    };
    expect(props.countLabel).toBe('audit events');
    expect(props.emptyMessage).toBe('No geolocated audit entries matched the current filters.');
    expect(props.filters).toMatchObject({
      action: 'LOGIN',
      search: 'ssh',
      targetType: 'Connection',
      gatewayId: 'gateway-1',
      userId: 'user-1',
      ipAddress: '8.8.8',
    });
    expect(props.filters.flaggedOnly).toBeUndefined();
    expect(props.filters.days).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'Mock geo map' }));
    expect(onCountryChange).toHaveBeenCalledWith('United States');
    expect(onViewModeChange).not.toHaveBeenCalled();
  });
});
