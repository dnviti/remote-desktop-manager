import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { GatewayData } from '../../api/gateway.api';
import type { TunnelStatusEvent } from '../../store/gatewayStore';
import ScalingControls from '../orchestration/ScalingControls';
import GatewayInstanceList from '../orchestration/GatewayInstanceList';
import {
  getGatewayEndpointValue,
  getGatewayHealthMeta,
  getGatewayTunnelMeta,
  isGatewayExpandable,
  type GatewayTestState,
} from './gatewaySectionUtils';
import { SettingsSummaryGrid, SettingsSummaryItem } from './settings-ui';

interface GatewayInventoryExpandedContentProps {
  gateway: GatewayData;
  pushState?: { loading: boolean; result?: { ok: boolean; error?: string } };
  testState?: GatewayTestState;
  tunnelStatus?: TunnelStatusEvent;
}

export default function GatewayInventoryExpandedContent({
  gateway,
  pushState,
  testState,
  tunnelStatus,
}: GatewayInventoryExpandedContentProps) {
  const health = getGatewayHealthMeta(gateway, testState);
  const tunnel = getGatewayTunnelMeta(gateway, tunnelStatus);
  const endpointValue = getGatewayEndpointValue(gateway);

  return (
    <div className="flex flex-col gap-4 bg-muted/15 px-4 py-4">
      <SettingsSummaryGrid className="xl:grid-cols-3">
        <SettingsSummaryItem label="Endpoint" value={endpointValue} />
        <SettingsSummaryItem label="Health" value={health.label} />
        <SettingsSummaryItem label="Tunnel" value={tunnel.label} />
      </SettingsSummaryGrid>

      <div className="grid gap-1 text-sm text-muted-foreground">
        <p>{gateway.description ?? 'No description provided.'}</p>
        <p>{health.description}</p>
        <p>{tunnel.description}</p>
      </div>

      {pushState?.result?.error ? (
        <Alert variant="destructive">
          <AlertTitle>SSH key push failed</AlertTitle>
          <AlertDescription>{pushState.result.error}</AlertDescription>
        </Alert>
      ) : pushState?.result?.ok ? (
        <Alert variant="success">
          <AlertTitle>SSH key pushed</AlertTitle>
          <AlertDescription>
            The public key was successfully deployed to this managed SSH gateway.
          </AlertDescription>
        </Alert>
      ) : null}

      {isGatewayExpandable(gateway) ? (
        <div className="flex flex-col gap-4 rounded-lg border border-border/70 bg-background/60 p-4">
          <div className="text-sm font-medium text-foreground">Managed group controls and instances</div>
          <ScalingControls gatewayId={gateway.id} gateway={gateway} />
          {gateway.totalInstances > 0 ? (
            <div className="flex flex-col gap-2">
              <div className="text-sm font-medium text-foreground">Instances</div>
              <GatewayInstanceList gatewayId={gateway.id} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No gateway instances are currently registered for this managed group.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
