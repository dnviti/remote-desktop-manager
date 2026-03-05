import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';
import { useGatewayStore } from '../store/gatewayStore';
import type {
  GatewayHealthEvent,
  GatewayData,
  ManagedInstanceData,
  ScalingStatusData,
} from '../api/gateway.api';

interface InstancesUpdatedEvent {
  gatewayId: string;
  instances: ManagedInstanceData[];
}

interface ScalingUpdatedEvent {
  gatewayId: string;
  scalingStatus: ScalingStatusData;
}

interface GatewayUpdatedEvent {
  gatewayId: string;
  gateway: Partial<GatewayData>;
}

export function useGatewayMonitor() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const tenantId = useAuthStore((s) => s.user?.tenantId);
  const applyHealthUpdate = useGatewayStore((s) => s.applyHealthUpdate);
  const applyInstancesUpdate = useGatewayStore((s) => s.applyInstancesUpdate);
  const applyScalingUpdate = useGatewayStore((s) => s.applyScalingUpdate);
  const applyGatewayUpdate = useGatewayStore((s) => s.applyGatewayUpdate);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!accessToken || !tenantId) return;

    const socket = io('/gateway-monitor', {
      auth: { token: accessToken },
      transports: ['websocket'],
    });

    socket.on('gateway:health', (event: GatewayHealthEvent) => {
      applyHealthUpdate(event);
    });

    socket.on('instances:updated', (event: InstancesUpdatedEvent) => {
      applyInstancesUpdate(event.gatewayId, event.instances);
    });

    socket.on('scaling:updated', (event: ScalingUpdatedEvent) => {
      applyScalingUpdate(event.gatewayId, event.scalingStatus);
    });

    socket.on('gateway:updated', (event: GatewayUpdatedEvent) => {
      applyGatewayUpdate(event.gatewayId, event.gateway);
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [accessToken, tenantId, applyHealthUpdate, applyInstancesUpdate, applyScalingUpdate, applyGatewayUpdate]);
}
