import { useFeatureFlagsStore } from './featureFlagsStore';
import { getPublicConfig } from '../api/auth.api';

vi.mock('../api/auth.api', () => ({
  getPublicConfig: vi.fn(),
}));

describe('useFeatureFlagsStore', () => {
  beforeEach(() => {
    useFeatureFlagsStore.setState({
      enabledCapabilities: [
        'keychain',
        'multi_tenancy',
        'connections',
        'ip_geolocation',
        'databases',
        'recordings',
        'zero_trust',
        'agentic_ai',
        'enterprise_auth',
        'sharing_approvals',
        'cli',
      ],
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
      loaded: false,
    });
    vi.resetAllMocks();
  });

  it('loads the richer runtime manifest from public config', async () => {
    vi.mocked(getPublicConfig).mockResolvedValue({
      selfSignupEnabled: false,
      features: {
        enabledCapabilities: ['connections', 'zero_trust', 'sharing_approvals'],
        databaseProxyEnabled: false,
        connectionsEnabled: true,
        ipGeolocationEnabled: false,
        keychainEnabled: false,
        multiTenancyEnabled: false,
        recordingsEnabled: false,
        zeroTrustEnabled: true,
        agenticAIEnabled: false,
        enterpriseAuthEnabled: false,
        sharingApprovalsEnabled: true,
        cliEnabled: false,
        mode: 'development',
        backend: 'kubernetes',
        routing: {
          directGateway: false,
          zeroTrust: true,
        },
      },
    });

    await useFeatureFlagsStore.getState().fetchFeatureFlags();

    expect(useFeatureFlagsStore.getState()).toMatchObject({
      enabledCapabilities: ['connections', 'zero_trust', 'sharing_approvals'],
      databaseProxyEnabled: false,
      connectionsEnabled: true,
      ipGeolocationEnabled: false,
      keychainEnabled: false,
      multiTenancyEnabled: false,
      recordingsEnabled: false,
      zeroTrustEnabled: true,
      agenticAIEnabled: false,
      enterpriseAuthEnabled: false,
      sharingApprovalsEnabled: true,
      cliEnabled: false,
      mode: 'development',
      backend: 'kubernetes',
      routing: {
        directGateway: false,
        zeroTrust: true,
      },
      loaded: true,
    });
  });
});
