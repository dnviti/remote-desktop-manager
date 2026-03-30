import { useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { useGatewayStore } from '../store/gatewayStore';

export function useGatewayMonitor() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const tenantId = useAuthStore((s) => s.user?.tenantId);

  useEffect(() => {
    if (!accessToken || !tenantId) return undefined;

    const refresh = () => {
      const state = useGatewayStore.getState();
      void state.fetchGateways();
      void state.fetchSessionCount();
      void state.fetchSessionCountByGateway();
      void state.fetchTunnelOverview();

      for (const gatewayId of Object.keys(state.instances)) {
        void state.fetchInstances(gatewayId);
      }

      for (const gatewayId of Object.keys(state.scalingStatus)) {
        void state.fetchScalingStatus(gatewayId);
      }
    };

    refresh();
    const interval = window.setInterval(refresh, 10_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [accessToken, tenantId]);
}
