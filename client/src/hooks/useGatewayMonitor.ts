import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';
import { useGatewayStore } from '../store/gatewayStore';
import type { GatewayHealthEvent } from '../api/gateway.api';

export function useGatewayMonitor() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const tenantId = useAuthStore((s) => s.user?.tenantId);
  const applyHealthUpdate = useGatewayStore((s) => s.applyHealthUpdate);
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

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [accessToken, tenantId, applyHealthUpdate]);
}
