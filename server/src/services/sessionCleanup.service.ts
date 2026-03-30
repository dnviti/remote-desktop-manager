import prisma from '../lib/prisma';
import * as auditService from './audit.service';
import * as dbTunnelService from './dbTunnel.service';
import { formatDuration } from '../utils/format';
import { logger } from '../utils/logger';
import { config } from '../config';
import { emitSessionTerminated } from '../socket/notification.handler';

export function initSessionCleanup(): void {
  // Real-time session cleanup signaling is handled by the Go brokers.
}

/**
 * Force-disconnect the live transport for a terminated session.
 * Browser SSH and desktop transports now observe closed session state via the
 * Go brokers, so only DB tunnel teardown still requires an explicit action here.
 */
export function forceDisconnectSession(session: {
  id: string;
  protocol: string;
  socketId: string | null;
  userId: string;
  connectionId?: string | null;
}): void {
  if (session.protocol === 'DB_TUNNEL') {
    // Close any associated DB tunnel by looking up tunnels for this user/connection
    const tunnels = dbTunnelService.getUserTunnels(session.userId);
    for (const tunnel of tunnels) {
      if (tunnel.connectionId === session.connectionId) {
        dbTunnelService.closeTunnel(tunnel.id);
      }
    }
  }

  emitSessionTerminated(session.userId, session.id, 'admin_terminated');
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
    logger.error('Session cleanup error:', err instanceof Error ? err.message : 'Unknown error');
    return 0;
  }
}
