import { Server } from 'socket.io';
import prisma from '../lib/prisma';
import * as auditService from './audit.service';
import * as dbTunnelService from './dbTunnel.service';
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

  if (session.protocol === 'RDP' || session.protocol === 'VNC') {
    emitSessionTerminated(session.userId, session.id, 'admin_terminated');
  }

  if (session.protocol === 'DB_TUNNEL') {
    // Close any associated DB tunnel by looking up tunnels for this user/connection
    const tunnels = dbTunnelService.getUserTunnels(session.userId);
    for (const tunnel of tunnels) {
      if (tunnel.connectionId === (session as { connectionId?: string }).connectionId) {
        dbTunnelService.closeTunnel(tunnel.id);
      }
    }
    emitSessionTerminated(session.userId, session.id, 'admin_terminated');
  }
}

export async function checkAndCloseInactiveSessions(): Promise<number> {
  try {
    const sessions = await prisma.activeSession.findMany({
      where: { status: { in: ['ACTIVE', 'IDLE'] } },
      include: {
        gateway: { select: { id: true, name: true, inactivityTimeoutSeconds: true } },
        user: { select: { tenantMemberships: { where: { isActive: true }, take: 1, include: { tenant: { select: { defaultSessionTimeoutSeconds: true, absoluteSessionTimeoutSeconds: true } } } } } },
      },
    });

    const now = Date.now();
    let closedCount = 0;

    for (const session of sessions) {
      const durationMs = now - session.startedAt.getTime();

      // Absolute timeout: close session regardless of activity
      const effectiveAbsoluteTimeout =
        session.user?.tenantMemberships[0]?.tenant.absoluteSessionTimeoutSeconds ??
        config.absoluteSessionTimeoutSeconds;

      if (effectiveAbsoluteTimeout > 0 && durationMs >= effectiveAbsoluteTimeout * 1000) {
        await prisma.activeSession.update({
          where: { id: session.id },
          data: { status: 'CLOSED', endedAt: new Date(now) },
        });

        auditService.log({
          userId: session.userId,
          action: 'SESSION_ABSOLUTE_TIMEOUT',
          targetType: 'Connection',
          targetId: session.connectionId,
          details: {
            sessionId: session.id,
            protocol: session.protocol,
            durationMs,
            durationFormatted: formatDuration(durationMs),
            absoluteTimeoutSeconds: effectiveAbsoluteTimeout,
            ...(session.gatewayId ? { gatewayName: session.gateway?.name ?? null, instanceId: session.instanceId } : {}),
          },
          ipAddress: session.ipAddress ?? undefined,
          gatewayId: session.gatewayId,
        });

        if (session.protocol === 'SSH' && session.socketId && ioInstance) {
          const socket = ioInstance.of('/ssh').sockets.get(session.socketId);
          if (socket) {
            socket.emit('session:timeout', { reason: 'absolute_timeout' });
            socket.disconnect(true);
          }
        }
        if (session.protocol === 'RDP' || session.protocol === 'VNC') {
          emitSessionTerminated(session.userId, session.id, 'absolute_timeout');
        }

        if (session.protocol === 'DB_TUNNEL') {
          // Close associated DB tunnels on absolute timeout
          const meta = session.metadata as { tunnelId?: string } | null;
          if (meta?.tunnelId) {
            dbTunnelService.closeTunnel(meta.tunnelId);
          }
          emitSessionTerminated(session.userId, session.id, 'absolute_timeout');
        }

        closedCount++;
        continue; // Skip inactivity check for this session
      }

      // Inactivity timeout
      const effectiveTimeout =
        session.gateway?.inactivityTimeoutSeconds ??
        session.user?.tenantMemberships[0]?.tenant.defaultSessionTimeoutSeconds ??
        config.sessionInactivityTimeoutSeconds;

      const inactiveMs = now - session.lastActivityAt.getTime();
      if (inactiveMs < effectiveTimeout * 1000) continue;

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
        ipAddress: session.ipAddress ?? undefined,
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

      // For DB_TUNNEL sessions: close the tunnel on inactivity timeout
      if (session.protocol === 'DB_TUNNEL') {
        const meta = session.metadata as { tunnelId?: string } | null;
        if (meta?.tunnelId) {
          dbTunnelService.closeTunnel(meta.tunnelId);
        }
        emitSessionTerminated(session.userId, session.id, 'session_timeout');
      }

      closedCount++;
    }

    return closedCount;
  } catch (err) {
    logger.error('Session cleanup error:', err);
    return 0;
  }
}
