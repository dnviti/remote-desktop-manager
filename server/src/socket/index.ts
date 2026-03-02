import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { setupSshHandler } from './ssh.handler';
import { setupNotificationHandler } from './notification.handler';
import { setupGatewayMonitorHandler } from './gatewayMonitor.handler';

export function setupSocketIO(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: ['http://localhost:3000'],
      methods: ['GET', 'POST'],
    },
  });

  setupSshHandler(io);
  setupNotificationHandler(io);
  setupGatewayMonitorHandler(io);

  return io;
}
