import { Server } from 'socket.io';
import prisma from '../lib/prisma';
import * as auditService from './audit.service';
import { formatDuration } from '../utils/format';
import { logger } from '../utils/logger';
import { config } from '../config';
import { emitSessionTerminated } from '../socket/notification.handler';

let ioInstance: Server | null = null;

export function initSessionCleanup(io: Server): void {
  ioInstance = io;
}

/**
 * Force-disconnect the live transport for a terminated session.
 * - SSH: emit session:terminated then disconnect the Socket.IO socket
 * - RDP: emit session:terminated to the user's browser via /notifications
 */
export function forceDisconnectSession(session: {
  id: string;
  protocol: string;
  socketId: string | null;
  userId: string;
}): void {
  if (!ioInstance) return;

  if (session.protocol === 'SSH' && session.socketId) {
    const socket = ioInstance.of('/ssh').sockets.get(session.socketId);
    if (socket) {
      socket.emit('session:terminated', { sessionId: session.id, reason: 'admin_terminated' });
      socket.disconnect(true);
    }
  }

  if (session.protocol === 'RDP') {
    emitSessionTerminated(session.userId, session.id, 'admin_terminated');
  }
}

export async function checkAndCloseInactiveSessions(): Promise<number> {
  try {
    const sessions = await prisma.activeSession.findMany({
      where: { status: { in: ['ACTIVE', 'IDLE'] } },
      include: {
        gateway: { select: { id: true, name: true, inactivityTimeoutSeconds: true } },
        user: { select: { tenantMemberships: { where: { isActive: true }, take: 1, include: { tenant: { select: { defaultSessionTimeoutSeconds: true } } } } } },
      },
    });

    const now = Date.now();
    let closedCount = 0;

    for (const session of sessions) {
      const effectiveTimeout =
        session.gateway?.inactivityTimeoutSeconds ??
        session.user?.tenantMemberships[0]?.tenant.defaultSessionTimeoutSeconds ??
        config.sessionInactivityTimeoutSeconds;

      const inactiveMs = now - session.lastActivityAt.getTime();
      if (inactiveMs < effectiveTimeout * 1000) continue;

      const durationMs = now - session.startedAt.getTime();

      // Mark CLOSED in DB first (before socket disconnect) to prevent
      // double audit logging — ssh.handler's endSessionBySocketId will
      // find the session already CLOSED and become a no-op.
      await prisma.activeSession.update({
        where: { id: session.id },
        data: { status: 'CLOSED', endedAt: new Date(now) },
      });

      auditService.log({
        userId: session.userId,
        action: 'SESSION_TIMEOUT',
        targetType: 'Connection',
        targetId: session.connectionId,
        details: {
          sessionId: session.id,
          protocol: session.protocol,
          durationMs,
          durationFormatted: formatDuration(durationMs),
          inactivitySeconds: Math.round(inactiveMs / 1000),
          effectiveTimeoutSeconds: effectiveTimeout,
          ...(session.gatewayId ? { gatewayName: session.gateway?.name ?? null, instanceId: session.instanceId } : {}),
        },
        gatewayId: session.gatewayId,
      });

      // For SSH sessions: force-disconnect the socket to trigger cleanup chain
      if (session.protocol === 'SSH' && session.socketId && ioInstance) {
        const socket = ioInstance.of('/ssh').sockets.get(session.socketId);
        if (socket) {
          socket.emit('session:timeout');
          socket.disconnect(true);
        }
      }

      closedCount++;
    }

    return closedCount;
  } catch (err) {
    logger.error('Session cleanup error:', err);
    return 0;
  }
}
