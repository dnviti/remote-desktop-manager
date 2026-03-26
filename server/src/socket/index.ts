import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { config } from '../config';
import { verifyJwt } from '../utils/jwt';
import { setupSshHandler } from './ssh.handler';
import { setupNotificationHandler } from './notification.handler';
import { setupGatewayMonitorHandler } from './gatewayMonitor.handler';
import { createGoCacheAdapterFactory } from '../utils/cacheAdapter';
import { logger } from '../utils/logger';

export function setupSocketIO(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: [config.clientUrl],
      methods: ['GET', 'POST'],
    },
  });

  // Use distributed adapter when cache sidecar is available
  const adapterFactory = createGoCacheAdapterFactory();
  if (adapterFactory) {
    io.adapter(adapterFactory);
    logger.info('Socket.IO using GoCacheAdapter for cross-instance events');
  }

  // Server-level auth middleware: reject unauthenticated connections
  // before they reach any namespace-specific middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required'));

    try {
      verifyJwt(token);
      next();
    } catch {
      next(new Error('Authentication required'));
    }
  });

  setupSshHandler(io);
  setupNotificationHandler(io);
  setupGatewayMonitorHandler(io);

  return io;
}
