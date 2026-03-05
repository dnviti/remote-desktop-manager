import prisma, { ManagedInstanceStatus } from '../lib/prisma';
import type { GatewayHealthStatus } from '../lib/prisma';
import { tcpProbe } from '../utils/tcpProbe';
import { logger } from '../utils/logger';

const log = logger.child('gateway-monitor');
const monitors = new Map<string, ReturnType<typeof setInterval>>();

export interface GatewayHealthEvent {
  gatewayId: string;
  status: GatewayHealthStatus;
  latencyMs: number | null;
  error: string | null;
  checkedAt: string;
}

let emitHealthUpdate: ((tenantId: string, payload: GatewayHealthEvent) => void) | null = null;

export function setHealthEmitter(fn: (tenantId: string, payload: GatewayHealthEvent) => void) {
  emitHealthUpdate = fn;
}

async function probeAndPersist(gatewayId: string, host: string, port: number, tenantId: string) {
  try {
    const result = await tcpProbe(host, port, 5000);
    const status: GatewayHealthStatus = result.reachable ? 'REACHABLE' : 'UNREACHABLE';
    const now = new Date();

    log.debug(`Probe ${gatewayId} (${host}:${port}): ${status}${result.latencyMs != null ? ` ${result.latencyMs}ms` : ''}`);

    // Detect state transition
    const prev = await prisma.gateway.findUnique({ where: { id: gatewayId }, select: { lastHealthStatus: true } });
    if (prev && prev.lastHealthStatus !== status) {
      log.info(`Gateway ${gatewayId} health changed: ${prev.lastHealthStatus ?? 'UNKNOWN'} → ${status}`);
    }

    await prisma.gateway.update({
      where: { id: gatewayId },
      data: {
        lastHealthStatus: status,
        lastCheckedAt: now,
        lastLatencyMs: result.latencyMs,
        lastError: result.error,
      },
    });

    if (emitHealthUpdate) {
      emitHealthUpdate(tenantId, {
        gatewayId,
        status,
        latencyMs: result.latencyMs,
        error: result.error,
        checkedAt: now.toISOString(),
      });
    }
  } catch (err) {
    log.error(`Probe failed for gateway ${gatewayId}:`, (err as Error).message);
  }
}

export function startMonitor(gatewayId: string, host: string, port: number, tenantId: string, intervalMs: number) {
  stopMonitor(gatewayId);

  log.info(`Starting monitor for ${gatewayId} (${host}:${port}, every ${intervalMs}ms)`);

  probeAndPersist(gatewayId, host, port, tenantId);

  const handle = setInterval(() => {
    probeAndPersist(gatewayId, host, port, tenantId);
  }, intervalMs);

  monitors.set(gatewayId, handle);
}

export function stopMonitor(gatewayId: string) {
  const handle = monitors.get(gatewayId);
  if (handle) {
    clearInterval(handle);
    monitors.delete(gatewayId);
    log.info(`Stopped monitor for ${gatewayId}`);
  }
}

export function restartMonitor(
  gatewayId: string,
  host: string,
  port: number,
  tenantId: string,
  intervalMs: number,
  enabled: boolean,
) {
  log.debug(`Restarting monitor for gateway ${gatewayId} (enabled=${enabled})`);
  stopMonitor(gatewayId);
  if (enabled) {
    startMonitor(gatewayId, host, port, tenantId, intervalMs);
  }
}

/**
 * For publishPorts managed gateways, probe each RUNNING instance's host:port
 * and derive the gateway-level health from the aggregate.
 */
async function probeInstancesAndPersist(gatewayId: string, tenantId: string) {
  try {
    const instances = await prisma.managedGatewayInstance.findMany({
      where: { gatewayId, status: ManagedInstanceStatus.RUNNING },
      select: { host: true, port: true },
    });

    if (instances.length === 0) {
      const now = new Date();
      await prisma.gateway.update({
        where: { id: gatewayId },
        data: { lastHealthStatus: 'UNREACHABLE', lastCheckedAt: now, lastLatencyMs: null, lastError: 'No running instances' },
      });
      if (emitHealthUpdate) {
        emitHealthUpdate(tenantId, { gatewayId, status: 'UNREACHABLE', latencyMs: null, error: 'No running instances', checkedAt: now.toISOString() });
      }
      return;
    }

    const results = await Promise.all(
      instances.map((inst) => tcpProbe(inst.host, inst.port, 5000)),
    );

    const reachable = results.filter((r) => r.reachable).length;
    const status: GatewayHealthStatus = reachable > 0 ? 'REACHABLE' : 'UNREACHABLE';

    log.debug(`Instance probe ${gatewayId}: ${reachable}/${instances.length} reachable`);

    // Detect aggregate state transition
    const prev = await prisma.gateway.findUnique({ where: { id: gatewayId }, select: { lastHealthStatus: true } });
    if (prev && prev.lastHealthStatus !== status) {
      log.info(`Gateway ${gatewayId} aggregate health changed: ${prev.lastHealthStatus ?? 'UNKNOWN'} → ${status} (${reachable}/${instances.length} instances reachable)`);
    }

    const avgLatency = reachable > 0
      ? Math.round(results.filter((r) => r.reachable).reduce((sum, r) => sum + (r.latencyMs ?? 0), 0) / reachable)
      : null;
    const error = reachable === instances.length
      ? null
      : `${reachable}/${instances.length} instances reachable`;
    const now = new Date();

    await prisma.gateway.update({
      where: { id: gatewayId },
      data: { lastHealthStatus: status, lastCheckedAt: now, lastLatencyMs: avgLatency, lastError: error },
    });

    if (emitHealthUpdate) {
      emitHealthUpdate(tenantId, { gatewayId, status, latencyMs: avgLatency, error, checkedAt: now.toISOString() });
    }
  } catch (err) {
    log.error(`Instance probe failed for gateway ${gatewayId}:`, (err as Error).message);
  }
}

export function startInstanceMonitor(gatewayId: string, tenantId: string, intervalMs: number) {
  stopMonitor(gatewayId);

  log.info(`Starting instance-based monitor for ${gatewayId} (every ${intervalMs}ms)`);

  probeInstancesAndPersist(gatewayId, tenantId);

  const handle = setInterval(() => {
    probeInstancesAndPersist(gatewayId, tenantId);
  }, intervalMs);

  monitors.set(gatewayId, handle);
}

export async function startAllMonitors() {
  const gateways = await prisma.gateway.findMany({
    where: { monitoringEnabled: true },
    select: { id: true, host: true, port: true, tenantId: true, monitorIntervalMs: true, publishPorts: true, type: true },
  });

  const isPublishPortsManaged = (gw: { publishPorts: boolean; type: string }) =>
    gw.publishPorts && (gw.type === 'MANAGED_SSH' || gw.type === 'GUACD');

  const probeable = gateways.filter((gw) => !isPublishPortsManaged(gw));
  const instanceBased = gateways.filter(isPublishPortsManaged);

  logger.info(
    `[gateway-monitor] Starting monitors for ${probeable.length} direct + ${instanceBased.length} instance-based (${gateways.length} total)`,
  );

  for (const gw of probeable) {
    startMonitor(gw.id, gw.host, gw.port, gw.tenantId, gw.monitorIntervalMs);
  }

  for (const gw of instanceBased) {
    startInstanceMonitor(gw.id, gw.tenantId, gw.monitorIntervalMs);
  }
}

export function stopAllMonitors() {
  log.info(`Stopping all monitors (${monitors.size} active)`);
  for (const [, handle] of monitors) {
    clearInterval(handle);
  }
  monitors.clear();
}
