import { Server, Socket } from 'socket.io';
import { AuthPayload } from '../types';
import { verifyJwt } from '../utils/jwt';
import { config } from '../config';
import { getSocketClientIp } from '../utils/ip';
import { computeBindingHash, getSocketUserAgent } from '../utils/tokenBinding';
import * as auditService from '../services/audit.service';
import { NotificationEntry } from '../services/notification.service';

let notificationNamespace: ReturnType<Server['of']> | null = null;

export function setupNotificationHandler(io: Server) {
  notificationNamespace = io.of('/notifications');

  notificationNamespace.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required'));

    try {
      const payload = verifyJwt<AuthPayload>(token);

      if (config.tokenBindingEnabled && payload.ipUaHash) {
        const socketUserAgent = getSocketUserAgent(socket);
        const currentHash = computeBindingHash(
          getSocketClientIp(socket),
          socketUserAgent,
        );
        if (currentHash !== payload.ipUaHash) {
          void auditService.log({
            userId: payload.userId,
            action: 'TOKEN_HIJACK_ATTEMPT',
            ipAddress: getSocketClientIp(socket),
            details: {
              namespace: '/notifications',
              userAgent: socketUserAgent,
              reason: 'Socket.IO token binding mismatch on /notifications',
            },
          });
          return next(new Error('Token binding mismatch'));
        }
      }

      (socket as Socket & { user: AuthPayload }).user = payload;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  notificationNamespace.on('connection', (socket) => {
    const user = (socket as Socket & { user: AuthPayload }).user;
    // Join a room named after the userId for targeted delivery
    socket.join(user.userId);
  });
}

/**
 * Emit a notification to a specific user via Socket.IO.
 * Safe to call even if the user is not connected — it simply won't deliver.
 */
export function emitNotification(userId: string, notification: NotificationEntry) {
  if (notificationNamespace) {
    notificationNamespace.to(userId).emit('notification:new', notification);
  }
}

/**
 * Notify a user's browser that a session was terminated by an admin.
 * Safe to call even if the user is not connected — it simply won't deliver.
 */
export function emitSessionTerminated(userId: string, sessionId: string, reason: string) {
  if (notificationNamespace) {
    notificationNamespace.to(userId).emit('session:terminated', { sessionId, reason });
  }
}
