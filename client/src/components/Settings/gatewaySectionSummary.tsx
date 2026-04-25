import type { GatewayData } from '../../api/gateway.api';
import { SettingsSummaryGrid, SettingsSummaryItem } from './settings-ui';

export function GatewayOverviewSummary({ gateways }: { gateways: GatewayData[] }) {
  const managedGateways = gateways.filter((gateway) => gateway.deploymentMode === 'MANAGED_GROUP').length;
  const tunnelEnabledGateways = gateways.filter((gateway) => gateway.tunnelEnabled).length;
  const defaultGateways = gateways.filter((gateway) => gateway.isDefault).length;

  return (
    <SettingsSummaryGrid>
      <SettingsSummaryItem label="Total gateways" value={String(gateways.length)} />
      <SettingsSummaryItem label="Managed groups" value={String(managedGateways)} />
      <SettingsSummaryItem label="Tunnel-enabled" value={String(tunnelEnabledGateways)} />
      <SettingsSummaryItem label="Default routes" value={String(defaultGateways)} />
    </SettingsSummaryGrid>
  );
}
