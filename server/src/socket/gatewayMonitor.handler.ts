import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { AuthPayload } from '../types';
import { setHealthEmitter, GatewayHealthEvent } from '../services/gatewayMonitor.service';

export function setupGatewayMonitorHandler(io: Server) {
  const gatewayMonitorNamespace = io.of('/gateway-monitor');

  gatewayMonitorNamespace.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required'));

    try {
      const payload = jwt.verify(token, config.jwtSecret) as AuthPayload;
      (socket as Socket & { user: AuthPayload }).user = payload;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  gatewayMonitorNamespace.on('connection', (socket) => {
    const user = (socket as Socket & { user: AuthPayload }).user;
    if (user.tenantId) {
      socket.join(user.tenantId);
    }
  });

  setHealthEmitter((tenantId: string, payload: GatewayHealthEvent) => {
    gatewayMonitorNamespace.to(tenantId).emit('gateway:health', payload);
  });
}
