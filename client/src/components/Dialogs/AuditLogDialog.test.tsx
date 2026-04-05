import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AuditLogDialog from './AuditLogDialog';
import { useAuthStore } from '../../store/authStore';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';
import { useUiPreferencesStore } from '../../store/uiPreferencesStore';

const {
  getAuditLogs,
  getAuditGateways,
  getAuditCountries,
  getSessionRecording,
  getDbAuditLogs,
  getDbAuditConnections,
  getDbAuditUsers,
  connectSSE,
  getRecording,
} = vi.hoisted(() => ({
  getAuditLogs: vi.fn(),
  getAuditGateways: vi.fn(),
  getAuditCountries: vi.fn(),
  getSessionRecording: vi.fn(),
  getDbAuditLogs: vi.fn(),
  getDbAuditConnections: vi.fn(),
  getDbAuditUsers: vi.fn(),
  connectSSE: vi.fn(),
  getRecording: vi.fn(),
}));

vi.mock('../../api/audit.api', () => ({
  getAuditLogs,
  getAuditGateways,
  getAuditCountries,
  getSessionRecording,
}));

vi.mock('../../api/dbAudit.api', () => ({
  getDbAuditLogs,
  getDbAuditConnections,
  getDbAuditUsers,
}));

vi.mock('../../api/sse', () => ({
  connectSSE,
}));

vi.mock('../../api/recordings.api', () => ({
  getRecording,
}));

describe('AuditLogDialog', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();

    getAuditLogs.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 25,
      totalPages: 0,
    });
    getAuditGateways.mockResolvedValue([]);
    getAuditCountries.mockResolvedValue([]);
    getDbAuditLogs.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 25,
      totalPages: 0,
    });
    getDbAuditConnections.mockResolvedValue([]);
    getDbAuditUsers.mockResolvedValue([]);
    connectSSE.mockReturnValue(() => {});
    getRecording.mockResolvedValue(null);
    getSessionRecording.mockResolvedValue(null);

    useAuthStore.setState({
      accessToken: null,
      csrfToken: null,
      user: {
        id: 'user-1',
        email: 'admin@example.com',
        username: 'admin',
        avatarData: null,
        tenantId: 'tenant-1',
        tenantRole: 'OWNER',
      },
      isAuthenticated: true,
      permissionsLoaded: false,
      permissionsLoading: false,
      permissionsSubject: null,
    });

    useFeatureFlagsStore.setState({
      databaseProxyEnabled: true,
      connectionsEnabled: true,
      ipGeolocationEnabled: true,
      keychainEnabled: true,
      multiTenancyEnabled: true,
      recordingsEnabled: true,
      zeroTrustEnabled: true,
      agenticAIEnabled: true,
      enterpriseAuthEnabled: true,
      sharingApprovalsEnabled: true,
      cliEnabled: true,
      mode: 'production',
      backend: 'podman',
      routing: {
        directGateway: true,
        zeroTrust: true,
      },
      loaded: true,
    });

    useUiPreferencesStore.setState({
      auditLogAction: '',
      auditLogSearch: '',
      auditLogTargetType: '',
      auditLogGatewayId: '',
      auditLogSortBy: 'createdAt',
      auditLogSortOrder: 'desc',
      auditLogAutoRefreshPaused: false,
      auditLogDialogTab: 'general',
    });
  });

  it('hides the SQL audit tab when database proxy is disabled', async () => {
    useFeatureFlagsStore.setState({ databaseProxyEnabled: false });
    useUiPreferencesStore.setState({ auditLogDialogTab: 'sql' });

    const view = render(<AuditLogDialog open onClose={() => {}} />);

    expect(await view.findByRole('tab', { name: 'General' })).toBeInTheDocument();
    expect(view.queryByRole('tab', { name: 'SQL Audit' })).not.toBeInTheDocument();
    expect(
      await view.findByPlaceholderText('Search across target, IP address, and details...'),
    ).toBeInTheDocument();

    expect(getAuditLogs).toHaveBeenCalled();
    expect(getDbAuditLogs).not.toHaveBeenCalled();
    expect(useUiPreferencesStore.getState().auditLogDialogTab).toBe('general');
  });

  it('shows the SQL audit tab when database proxy is enabled', async () => {
    useUiPreferencesStore.setState({ auditLogDialogTab: 'sql' });

    const view = render(<AuditLogDialog open onClose={() => {}} />);

    expect(await view.findByRole('tab', { name: 'SQL Audit' })).toBeInTheDocument();
    expect(
      await view.findByPlaceholderText('Search SQL queries, tables, or block reasons...'),
    ).toBeInTheDocument();

    expect(getDbAuditLogs).toHaveBeenCalled();
  });
});
