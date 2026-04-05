import { useEffect } from 'react';
import type { GatewayStreamSnapshot } from '../api/live.api';
import { connectSSE } from '../api/sse';
import { useAuthStore } from '../store/authStore';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';
import { useGatewayStore } from '../store/gatewayStore';

export function useGatewayMonitor() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const tenantId = useAuthStore((s) => s.user?.tenantId);
  const permissionsLoaded = useAuthStore((s) => s.permissionsLoaded);
  const canManageGateways = useAuthStore((s) => s.permissions.canManageGateways);
  const featureFlagsLoaded = useFeatureFlagsStore((s) => s.loaded);
  const zeroTrustEnabled = useFeatureFlagsStore((s) => s.zeroTrustEnabled);
  const watchedScaling = useGatewayStore((s) => Object.keys(s.watchedScalingGatewayIds).sort().join(','));
  const watchedInstances = useGatewayStore((s) => Object.keys(s.watchedInstanceGatewayIds).sort().join(','));
  const applyGatewayStreamSnapshot = useGatewayStore((s) => s.applyGatewayStreamSnapshot);

  useEffect(() => {
    if (!accessToken || !tenantId || !permissionsLoaded || !canManageGateways || !featureFlagsLoaded || !zeroTrustEnabled) return undefined;

    const params = new URLSearchParams();
    for (const gatewayId of watchedScaling.split(',').filter(Boolean)) {
      params.append('watchScaling', gatewayId);
    }
    for (const gatewayId of watchedInstances.split(',').filter(Boolean)) {
      params.append('watchInstances', gatewayId);
    }
    const query = params.toString();

    return connectSSE({
      url: query ? `/api/gateways/stream?${query}` : '/api/gateways/stream',
      accessToken,
      onEvent: ({ event, data }) => {
        if (event !== 'snapshot') return;
        applyGatewayStreamSnapshot(data as GatewayStreamSnapshot);
      },
    });
  }, [accessToken, tenantId, permissionsLoaded, canManageGateways, featureFlagsLoaded, zeroTrustEnabled, watchedScaling, watchedInstances, applyGatewayStreamSnapshot]);
}
