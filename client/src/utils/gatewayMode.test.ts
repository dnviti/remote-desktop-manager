import {
  gatewayAddressLabel,
  gatewayEndpointLabel,
  gatewayModeLabel,
  isGatewayGroup,
} from './gatewayMode';

describe('gatewayMode utilities', () => {
  it('detects managed groups from deployment mode or managed fallback', () => {
    expect(isGatewayGroup({ deploymentMode: 'MANAGED_GROUP' })).toBe(true);
    expect(isGatewayGroup({ isManaged: true })).toBe(true);
    expect(isGatewayGroup({ deploymentMode: 'SINGLE_INSTANCE', isManaged: true })).toBe(false);
    expect(isGatewayGroup(null)).toBe(false);
  });

  it('builds mode and endpoint labels consistently', () => {
    expect(gatewayModeLabel({ deploymentMode: 'MANAGED_GROUP' })).toBe('Managed Group');
    expect(gatewayModeLabel({ host: 'gw.example.com', port: 8443 })).toBe('Single Instance');
    expect(gatewayEndpointLabel({ deploymentMode: 'MANAGED_GROUP', host: 'gw', port: 8443 })).toBe(
      'Managed Group'
    );
    expect(gatewayEndpointLabel({ host: 'gw.example.com', port: 8443 })).toBe('gw.example.com:8443');
    expect(gatewayEndpointLabel(undefined)).toBe('');
  });

  it('formats raw gateway addresses', () => {
    expect(gatewayAddressLabel({ host: 'template.example.com', port: 9443 })).toBe(
      'template.example.com:9443'
    );
  });
});
