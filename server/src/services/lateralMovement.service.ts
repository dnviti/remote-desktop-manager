/**
 * Lateral Movement Anomaly Detection Service (MITRE T1021: Remote Services)
 *
 * Monitors the rate and diversity of remote connections initiated by a user.
 * If a user connects to more distinct targets than the configured threshold
 * within a sliding time window, the service:
 *   1. Logs an ANOMALOUS_LATERAL_MOVEMENT audit event
 *   2. Applies a soft-lockout on the user account (sets lockedUntil)
 *   3. Notifies tenant admins via the notification system
 *
 * Configuration (environment variables):
 *   LATERAL_MOVEMENT_DETECTION_ENABLED  — enable/disable (default: true)
 *   LATERAL_MOVEMENT_MAX_DISTINCT_TARGETS — threshold (default: 10)
 *   LATERAL_MOVEMENT_WINDOW_MINUTES       — sliding window (default: 5)
 *   LATERAL_MOVEMENT_LOCKOUT_MINUTES      — soft-lockout duration (default: 30)
 */

import prisma from '../lib/prisma';
import { config } from '../config';
import { logger } from '../utils/logger';
import * as auditService from './audit.service';
import * as notificationService from './notification.service';

const log = logger.child('lateral-movement');

export interface LateralMovementCheckResult {
  allowed: boolean;
  distinctTargets?: number;
  threshold?: number;
  windowMinutes?: number;
}

/**
 * Check whether the user's recent session starts indicate anomalous lateral
 * movement. This function queries SESSION_START audit events from the sliding
 * time window and counts distinct connection targets.
 *
 * Call this BEFORE creating a new session. If the check fails, the caller
 * should deny the session and return an appropriate error.
 *
 * Returns `{ allowed: true }` when the user is within normal bounds, or
 * `{ allowed: false, ... }` when the threshold is exceeded (side-effects:
 * audit log, admin notification, soft-lockout are all applied).
 */
export async function checkLateralMovement(
  userId: string,
  connectionId: string,
  ipAddress?: string | null,
): Promise<LateralMovementCheckResult> {
  if (!config.lateralMovementEnabled) {
    return { allowed: true };
  }

  const windowMs = config.lateralMovementWindowMinutes * 60 * 1000;
  const since = new Date(Date.now() - windowMs);
  const threshold = config.lateralMovementMaxDistinctTargets;

  try {
    // Count distinct connection targets from SESSION_START events in the window
    const recentSessions = await prisma.auditLog.findMany({
      where: {
        userId,
        action: 'SESSION_START',
        createdAt: { gte: since },
        targetId: { not: null },
      },
      select: { targetId: true },
    });

    // Collect distinct target IDs (connection IDs)
    const distinctTargets = new Set<string>();
    for (const entry of recentSessions) {
      if (entry.targetId) distinctTargets.add(entry.targetId);
    }
    // Include the connection about to be started
    distinctTargets.add(connectionId);

    if (distinctTargets.size <= threshold) {
      return { allowed: true };
    }

    // --- Threshold exceeded: lateral movement anomaly detected ---

    log.warn(
      `Lateral movement anomaly detected for user ${userId}: ` +
      `${distinctTargets.size} distinct targets in ${config.lateralMovementWindowMinutes} min ` +
      `(threshold: ${threshold})`,
    );

    // 1. Audit log
    auditService.log({
      userId,
      action: 'ANOMALOUS_LATERAL_MOVEMENT',
      targetType: 'User',
      targetId: userId,
      details: {
        distinctTargets: distinctTargets.size,
        threshold,
        windowMinutes: config.lateralMovementWindowMinutes,
        recentConnectionIds: Array.from(distinctTargets),
        deniedConnectionId: connectionId,
      },
      ipAddress: ipAddress ?? undefined,
    });

    // 2. Soft-lockout: set lockedUntil on the user account
    const lockoutUntil = new Date(Date.now() + config.lateralMovementLockoutMinutes * 60 * 1000);
    await prisma.user.update({
      where: { id: userId },
      data: { lockedUntil: lockoutUntil },
    });

    log.warn(
      `User ${userId} soft-locked until ${lockoutUntil.toISOString()} due to lateral movement anomaly`,
    );

    // 3. Notify tenant admins
    await notifyTenantAdmins(
      userId,
      distinctTargets.size,
      config.lateralMovementWindowMinutes,
      config.lateralMovementLockoutMinutes,
    );

    return {
      allowed: false,
      distinctTargets: distinctTargets.size,
      threshold,
      windowMinutes: config.lateralMovementWindowMinutes,
    };
  } catch (err) {
    // Never block a session due to detection failures — log and allow
    log.error('Lateral movement check failed:', err);
    return { allowed: true };
  }
}

/**
 * Notify all tenant OWNER/ADMIN users about a lateral movement anomaly.
 * Follows the same pattern as impossibleTravel.service.ts.
 */
async function notifyTenantAdmins(
  userId: string,
  distinctTargets: number,
  windowMinutes: number,
  lockoutMinutes: number,
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        username: true,
        email: true,
        tenantMemberships: {
          where: { isActive: true },
          select: {
            tenant: {
              select: {
                members: {
                  where: {
                    isActive: true,
                    role: { in: ['OWNER', 'ADMIN'] },
                  },
                  select: { userId: true },
                },
              },
            },
          },
        },
      },
    });

    if (!user) return;

    const displayName = user.username || user.email;
    const message =
      `Lateral movement anomaly detected for ${displayName}: ` +
      `${distinctTargets} distinct targets in ${windowMinutes} min. ` +
      `Account temporarily suspended for ${lockoutMinutes} min.`;

    // Collect unique admin user IDs across all tenants
    const adminIds = new Set<string>();
    for (const membership of user.tenantMemberships) {
      for (const admin of membership.tenant.members) {
        if (admin.userId !== userId) {
          adminIds.add(admin.userId);
        }
      }
    }

    for (const adminId of adminIds) {
      notificationService.createNotificationAsync({
        userId: adminId,
        type: 'LATERAL_MOVEMENT_ALERT',
        message,
        relatedId: userId,
      });
    }
  } catch (err) {
    log.error('Failed to notify tenant admins about lateral movement:', err);
  }
}
