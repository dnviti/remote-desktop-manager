import type {
  GatewayData,
  GatewayDeploymentMode,
  GatewayTemplateData,
} from '../api/gateway.api';

type GatewayLike = {
  deploymentMode?: GatewayDeploymentMode | null;
  isManaged?: boolean;
  host?: string | null;
  port?: number | null;
};

export function isGatewayGroup(gateway: GatewayLike | null | undefined): boolean {
  if (!gateway) return false;
  if (gateway.deploymentMode) return gateway.deploymentMode === 'MANAGED_GROUP';
  return Boolean(gateway.isManaged);
}

export function gatewayModeLabel(gateway: GatewayLike | null | undefined): string {
  return isGatewayGroup(gateway) ? 'Managed Group' : 'Single Instance';
}

export function gatewayEndpointLabel(gateway: GatewayLike | null | undefined): string {
  if (!gateway) return '';
  if (isGatewayGroup(gateway)) return 'Managed Group';
  return `${gateway.host ?? ''}:${gateway.port ?? ''}`;
}

export function gatewayAddressLabel(gateway: Pick<GatewayData, 'host' | 'port'> | Pick<GatewayTemplateData, 'host' | 'port'>): string {
  return `${gateway.host}:${gateway.port}`;
}
