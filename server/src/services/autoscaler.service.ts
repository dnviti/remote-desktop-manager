import prisma, { ManagedInstanceStatus } from '../lib/prisma';
import * as managedGatewayService from './managedGateway.service';
import * as sessionService from './session.service';
import * as auditService from './audit.service';
import { logger } from '../utils/logger';
import { emitScalingForGateway } from './gatewayMonitor.service';

const log = logger.child('autoscaler');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScalingStatus {
  gatewayId: string;
  autoScale: boolean;
  minReplicas: number;
  maxReplicas: number;
  sessionsPerInstance: number;
  scaleDownCooldownSeconds: number;
  currentReplicas: number;
  activeSessions: number;
  targetReplicas: number;
  lastScaleAction: Date | null;
  cooldownRemaining: number;
  recommendation: 'scale-up' | 'scale-down' | 'stable';
  instanceSessions: Array<{ instanceId: string; containerName: string; count: number }>;
}

// ---------------------------------------------------------------------------
// Core: evaluateScaling — runs every 30s
// ---------------------------------------------------------------------------

export async function evaluateScaling(): Promise<void> {
  const gateways = await prisma.gateway.findMany({
    where: { deploymentMode: 'MANAGED_GROUP', autoScale: true },
    select: {
      id: true,
      minReplicas: true,
      maxReplicas: true,
      sessionsPerInstance: true,
      scaleDownCooldownSeconds: true,
      lastScaleAction: true,
      desiredReplicas: true,
    },
  });

  if (gateways.length === 0) return;

  log.debug(`Evaluating scaling for ${gateways.length} auto-scale gateways`);

  for (const gw of gateways) {
    try {
      await evaluateGatewayScaling(gw);
    } catch (err) {
      log.error(
        `Scaling evaluation failed for gateway ${gw.id}: ${(err as Error).message}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Per-gateway scaling evaluation
// ---------------------------------------------------------------------------

async function evaluateGatewayScaling(gw: {
  id: string;
  minReplicas: number;
  maxReplicas: number;
  sessionsPerInstance: number;
  scaleDownCooldownSeconds: number;
  lastScaleAction: Date | null;
  desiredReplicas: number;
}): Promise<void> {
  // Count active sessions (ACTIVE + IDLE) for this gateway
  const activeSessions = await sessionService.getActiveSessionCount({
    gatewayId: gw.id,
  });

  // Count RUNNING/PROVISIONING instances
  const currentReplicas = await prisma.managedGatewayInstance.count({
    where: {
      gatewayId: gw.id,
      status: {
        in: [ManagedInstanceStatus.RUNNING, ManagedInstanceStatus.PROVISIONING],
      },
    },
  });

  // Calculate target: ceil(activeSessions / sessionsPerInstance)
  const rawTarget =
    activeSessions === 0 ? 0 : Math.ceil(activeSessions / gw.sessionsPerInstance);

  // Clamp between minReplicas and maxReplicas
  const target = Math.max(gw.minReplicas, Math.min(rawTarget, gw.maxReplicas));

  if (target > currentReplicas) {
    // ---- Scale UP (immediate) ----
    log.info(
      `Gateway ${gw.id}: scaling UP ${currentReplicas} → ${target} ` +
        `(${activeSessions} sessions, threshold ${gw.sessionsPerInstance}/instance)`,
    );

    await managedGatewayService.scaleGateway(gw.id, target);

    await prisma.gateway.update({
      where: { id: gw.id },
      data: { lastScaleAction: new Date() },
    });

    auditService.log({
      action: 'GATEWAY_SCALE_UP',
      targetType: 'Gateway',
      targetId: gw.id,
      details: {
        from: currentReplicas,
        to: target,
        activeSessions,
        sessionsPerInstance: gw.sessionsPerInstance,
        trigger: 'autoscaler',
      },
    });
  } else if (target < currentReplicas) {
    // ---- Scale DOWN (with cooldown check) ----
    const now = Date.now();
    const cooldownMs = gw.scaleDownCooldownSeconds * 1000;
    const lastScale = gw.lastScaleAction?.getTime() ?? 0;

    if (now - lastScale < cooldownMs) {
      const remaining = Math.ceil((cooldownMs - (now - lastScale)) / 1000);
      log.debug(
        `Gateway ${gw.id}: scale-down deferred, cooldown ${remaining}s remaining`,
      );
      // Still emit so clients see updated session counts and cooldown
      emitScalingForGateway(gw.id).catch(() => {});
      return;
    }

    log.info(
      `Gateway ${gw.id}: scaling DOWN ${currentReplicas} → ${target} ` +
        `(${activeSessions} sessions, threshold ${gw.sessionsPerInstance}/instance)`,
    );

    await scaleDownPreferEmpty(gw.id, currentReplicas, target);

    await prisma.gateway.update({
      where: { id: gw.id },
      data: { lastScaleAction: new Date(), desiredReplicas: target },
    });

    auditService.log({
      action: 'GATEWAY_SCALE_DOWN',
      targetType: 'Gateway',
      targetId: gw.id,
      details: {
        from: currentReplicas,
        to: target,
        activeSessions,
        sessionsPerInstance: gw.sessionsPerInstance,
        trigger: 'autoscaler',
      },
    });
  }

  // Push updated scaling status to clients (covers scale-up, scale-down, and stable)
  emitScalingForGateway(gw.id).catch(() => {});
}

// ---------------------------------------------------------------------------
// Scale-down: prefer removing instances with zero sessions, then fewest sessions, then LIFO
// ---------------------------------------------------------------------------

async function scaleDownPreferEmpty(
  gatewayId: string,
  currentReplicas: number,
  targetReplicas: number,
): Promise<void> {
  const toRemove = currentReplicas - targetReplicas;

  // Get running instances with active session counts, newest-first as tiebreaker
  const instances = await prisma.managedGatewayInstance.findMany({
    where: {
      gatewayId,
      status: {
        in: [ManagedInstanceStatus.RUNNING, ManagedInstanceStatus.PROVISIONING],
      },
    },
    include: {
      _count: {
        select: {
          sessions: { where: { status: { not: 'CLOSED' } } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Sort by session count ascending (zero-session first); createdAt desc is preserved as tiebreaker
  const sorted = [...instances].sort((a, b) => a._count.sessions - b._count.sessions);

  const instancesToRemove = sorted.slice(0, toRemove);

  for (const instance of instancesToRemove) {
    try {
      await managedGatewayService.removeGatewayInstance(instance.id);
      auditService.log({
        userId: null,
        action: 'GATEWAY_UNDEPLOY',
        targetType: 'ManagedGatewayInstance',
        targetId: instance.id,
        details: {
          gatewayId,
          trigger: 'autoscaler',
          containerId: instance.containerId,
        },
      });
    } catch (err) {
      log.error(
        `Scale-down: failed to remove instance ${instance.id}: ${(err as Error).message}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// getScalingStatus
// ---------------------------------------------------------------------------

export async function getScalingStatus(
  gatewayId: string,
): Promise<ScalingStatus> {
  const gateway = await prisma.gateway.findUnique({
    where: { id: gatewayId },
    select: {
      id: true,
      autoScale: true,
      desiredReplicas: true,
      minReplicas: true,
      maxReplicas: true,
      sessionsPerInstance: true,
      scaleDownCooldownSeconds: true,
      lastScaleAction: true,
    },
  });

  if (!gateway) {
    throw new Error('Gateway not found');
  }

  const [activeSessions, currentReplicas, instanceSessionData] = await Promise.all([
    sessionService.getActiveSessionCount({ gatewayId }),
    prisma.managedGatewayInstance.count({
      where: {
        gatewayId,
        status: {
          in: [
            ManagedInstanceStatus.RUNNING,
            ManagedInstanceStatus.PROVISIONING,
          ],
        },
      },
    }),
    prisma.managedGatewayInstance.findMany({
      where: {
        gatewayId,
        status: {
          in: [ManagedInstanceStatus.RUNNING, ManagedInstanceStatus.PROVISIONING],
        },
      },
      select: {
        id: true,
        containerName: true,
        _count: {
          select: {
            sessions: { where: { status: { not: 'CLOSED' } } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  // When auto-scale is off, target = desiredReplicas (user's manual choice)
  // When auto-scale is on, target = calculated from session load
  let targetReplicas: number;
  if (gateway.autoScale) {
    const rawTarget =
      activeSessions === 0
        ? 0
        : Math.ceil(activeSessions / gateway.sessionsPerInstance);
    targetReplicas = Math.max(
      gateway.minReplicas,
      Math.min(rawTarget, gateway.maxReplicas),
    );
  } else {
    targetReplicas = gateway.desiredReplicas;
  }

  let cooldownRemaining = 0;
  if (gateway.autoScale && gateway.lastScaleAction) {
    const elapsed = Date.now() - gateway.lastScaleAction.getTime();
    const cooldownMs = gateway.scaleDownCooldownSeconds * 1000;
    if (elapsed < cooldownMs) {
      cooldownRemaining = Math.ceil((cooldownMs - elapsed) / 1000);
    }
  }

  let recommendation: 'scale-up' | 'scale-down' | 'stable';
  if (!gateway.autoScale) {
    // Manual mode — no auto-scaling recommendations
    recommendation = 'stable';
  } else if (targetReplicas > currentReplicas) {
    recommendation = 'scale-up';
  } else if (targetReplicas < currentReplicas) {
    recommendation = 'scale-down';
  } else {
    recommendation = 'stable';
  }

  return {
    gatewayId: gateway.id,
    autoScale: gateway.autoScale,
    minReplicas: gateway.minReplicas,
    maxReplicas: gateway.maxReplicas,
    sessionsPerInstance: gateway.sessionsPerInstance,
    scaleDownCooldownSeconds: gateway.scaleDownCooldownSeconds,
    currentReplicas,
    activeSessions,
    targetReplicas,
    lastScaleAction: gateway.lastScaleAction,
    cooldownRemaining,
    recommendation,
    instanceSessions: instanceSessionData.map((i) => ({
      instanceId: i.id,
      containerName: i.containerName,
      count: i._count.sessions,
    })),
  };
}
