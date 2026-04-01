import prisma, { ManagedInstanceStatus } from '../lib/prisma';
import type { GatewayHealthStatus } from '../lib/prisma';
import { tcpProbe } from '../utils/tcpProbe';
import { hasTunnel, getTunnelInfo } from './tunnel.service';
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

export interface TunnelMetricsEvent {
  gatewayId: string;
  connectedAt: string;
  uptimeMs: number;
  rttMs: number | null;
  activeStreams: number;
  bytesTransferred: number;
  agentHealthy: boolean | null;
  checkedAt: string;
}

// ---------------------------------------------------------------------------
// Emitter callbacks — set by the Socket.IO handler at startup
// ---------------------------------------------------------------------------

let emitHealthUpdate: ((tenantId: string, payload: GatewayHealthEvent) => void) | null = null;
let emitInstancesUpdate: ((tenantId: string, payload: InstancesUpdatedEvent) => void) | null = null;
let emitScalingUpdate: ((tenantId: string, payload: ScalingUpdatedEvent) => void) | null = null;
let emitGatewayUpdate: ((tenantId: string, payload: GatewayUpdatedEvent) => void) | null = null;
let emitTunnelMetricsUpdate: ((tenantId: string, payload: TunnelMetricsEvent) => void) | null = null;

export interface InstancesUpdatedEvent {
  gatewayId: string;
  instances: Array<{
    id: string;
    containerId: string;
    containerName: string;
    host: string;
    port: number;
    status: string;
    healthStatus: string | null;
    errorMessage: string | null;
    createdAt: string;
    apiPort: number | null;
  }>;
}

export interface ScalingUpdatedEvent {
  gatewayId: string;
  scalingStatus: Record<string, unknown>;
}

export interface GatewayUpdatedEvent {
  gatewayId: string;
  gateway: Record<string, unknown>;
}

export function setHealthEmitter(fn: (tenantId: string, payload: GatewayHealthEvent) => void) {
  emitHealthUpdate = fn;
}

export function setInstancesEmitter(fn: (tenantId: string, payload: InstancesUpdatedEvent) => void) {
  emitInstancesUpdate = fn;
}

export function setScalingEmitter(fn: (tenantId: string, payload: ScalingUpdatedEvent) => void) {
  emitScalingUpdate = fn;
}

export function setGatewayEmitter(fn: (tenantId: string, payload: GatewayUpdatedEvent) => void) {
  emitGatewayUpdate = fn;
}

export function setTunnelMetricsEmitter(fn: (tenantId: string, payload: TunnelMetricsEvent) => void) {
  emitTunnelMetricsUpdate = fn;
}

// ---------------------------------------------------------------------------
// Emit helpers — read fresh DB state and push to clients
// ---------------------------------------------------------------------------

export async function emitInstancesForGateway(gatewayId: string) {
  if (!emitInstancesUpdate) return;
  try {
    const gateway = await prisma.gateway.findUnique({
      where: { id: gatewayId },
      select: { tenantId: true },
    });
    if (!gateway) return;
    const instances = await prisma.managedGatewayInstance.findMany({
      where: { gatewayId },
      orderBy: { createdAt: 'asc' },
    });
    emitInstancesUpdate(gateway.tenantId, {
      gatewayId,
      instances: instances.map((i) => ({
        id: i.id,
        containerId: i.containerId,
        containerName: i.containerName,
        host: i.host,
        port: i.port,
        status: i.status,
        healthStatus: i.healthStatus,
        errorMessage: i.errorMessage,
        createdAt: i.createdAt.toISOString(),
        apiPort: i.apiPort,
      })),
    });
  } catch (err) {
    log.error(`emitInstancesForGateway failed for ${gatewayId}:`, (err as Error).message);
  }
}

export async function emitScalingForGateway(gatewayId: string) {
  if (!emitScalingUpdate) return;
  try {
    const gateway = await prisma.gateway.findUnique({
      where: { id: gatewayId },
      select: { tenantId: true },
    });
    if (!gateway) return;
    // Dynamic import to avoid circular dependency with autoscaler.service
    const { getScalingStatus } = await import('./autoscaler.service');
    const scalingStatus = await getScalingStatus(gatewayId);
    emitScalingUpdate(gateway.tenantId, {
      gatewayId,
      scalingStatus: scalingStatus as unknown as Record<string, unknown>,
    });
  } catch (err) {
    log.error(`emitScalingForGateway failed for ${gatewayId}:`, (err as Error).message);
  }
}

export async function emitGatewayData(gatewayId: string) {
  if (!emitGatewayUpdate) return;
  try {
    const gw = await prisma.gateway.findUnique({ where: { id: gatewayId } });
    if (!gw) return;
    const [totalInstances, runningInstances] = await Promise.all([
      prisma.managedGatewayInstance.count({ where: { gatewayId } }),
      prisma.managedGatewayInstance.count({
        where: { gatewayId, status: { in: ['RUNNING', 'PROVISIONING'] } },
      }),
    ]);
    emitGatewayUpdate(gw.tenantId, {
      gatewayId,
      gateway: {
        id: gw.id,
        deploymentMode: gw.deploymentMode,
        isManaged: gw.deploymentMode === 'MANAGED_GROUP',
        desiredReplicas: gw.desiredReplicas,
        autoScale: gw.autoScale,
        minReplicas: gw.minReplicas,
        maxReplicas: gw.maxReplicas,
        sessionsPerInstance: gw.sessionsPerInstance,
        scaleDownCooldownSeconds: gw.scaleDownCooldownSeconds,
        lastScaleAction: gw.lastScaleAction?.toISOString() ?? null,
        totalInstances,
        runningInstances,
      },
    });
  } catch (err) {
    log.error(`emitGatewayData failed for ${gatewayId}:`, (err as Error).message);
  }
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

const MIN_MONITOR_INTERVAL_MS = 5_000;   // 5 seconds
const MAX_MONITOR_INTERVAL_MS = 300_000; // 5 minutes
const DEFAULT_MONITOR_INTERVAL_MS = 30_000; // 30 seconds

/**
 * Clamp an interval to safe bounds with rounding.
 * Out-of-range values are replaced by a defined constant (default, min, or max).
 * In-range values are rounded to the nearest integer via toFixed(0).
 */
function clampInterval(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return DEFAULT_MONITOR_INTERVAL_MS;
  if (ms < MIN_MONITOR_INTERVAL_MS) return MIN_MONITOR_INTERVAL_MS;
  if (ms > MAX_MONITOR_INTERVAL_MS) return MAX_MONITOR_INTERVAL_MS;
  // Return a server-owned copy via arithmetic identity (breaks taint tracking)
  return Number(ms.toFixed(0));
}

export function startMonitor(gatewayId: string, host: string, port: number, tenantId: string, intervalMs: number) {
  stopMonitor(gatewayId);

  const safeInterval = clampInterval(intervalMs);
  log.info(`Starting monitor for ${gatewayId} (${host}:${port}, every ${safeInterval}ms)`);

  probeAndPersist(gatewayId, host, port, tenantId);

  const handle = setInterval(() => {
    probeAndPersist(gatewayId, host, port, tenantId);
  }, safeInterval);

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

  const safeInterval = clampInterval(intervalMs);
  log.info(`Starting instance-based monitor for ${gatewayId} (every ${safeInterval}ms)`);

  probeInstancesAndPersist(gatewayId, tenantId);

  const handle = setInterval(() => {
    probeInstancesAndPersist(gatewayId, tenantId);
  }, safeInterval);

  monitors.set(gatewayId, handle);
}

// ---------------------------------------------------------------------------
// Tunnel-based health monitoring
// ---------------------------------------------------------------------------

const TUNNEL_HEARTBEAT_TIMEOUT_MS = 45_000; // 45 s

/**
 * Determine gateway health from tunnel state instead of a TCP probe.
 *
 * Health mapping:
 *   - No active tunnel OR heartbeat older than 45 s  → UNREACHABLE
 *   - Tunnel connected + recent heartbeat + agent healthy → REACHABLE
 *   - Tunnel connected + recent heartbeat + agent unhealthy → DEGRADED (stored as UNREACHABLE;
 *     the error field carries the detail)
 */
async function probeViaTunnel(gatewayId: string, tenantId: string): Promise<void> {
  try {
    const now = new Date();
    const connected = hasTunnel(gatewayId);
    const info = getTunnelInfo(gatewayId);

    let status: GatewayHealthStatus;
    let latencyMs: number | null = null;
    let error: string | null = null;

    if (!connected || !info) {
      status = 'UNREACHABLE';
      error = 'Tunnel not connected';
    } else {
      const heartbeatAge = info.lastHeartbeat
        ? now.getTime() - info.lastHeartbeat.getTime()
        : Infinity;

      if (heartbeatAge > TUNNEL_HEARTBEAT_TIMEOUT_MS) {
        status = 'UNREACHABLE';
        error = `Heartbeat timeout (last: ${info.lastHeartbeat?.toISOString() ?? 'never'})`;
      } else if (info.heartbeatMetadata && !info.heartbeatMetadata.healthy) {
        // Agent reports the local service is unhealthy — surface as UNREACHABLE with detail
        status = 'UNREACHABLE';
        error = 'Agent reports local service unhealthy';
      } else {
        status = 'REACHABLE';
        latencyMs = info.pingPongLatency ?? null;
      }
    }

    log.debug(`Tunnel probe ${gatewayId}: ${status}${latencyMs != null ? ` ${latencyMs}ms RTT` : ''}`);

    // Detect state transition
    const prev = await prisma.gateway.findUnique({ where: { id: gatewayId }, select: { lastHealthStatus: true } });
    if (prev && prev.lastHealthStatus !== status) {
      log.info(`Gateway ${gatewayId} tunnel health changed: ${prev.lastHealthStatus ?? 'UNKNOWN'} → ${status}`);
    }

    await prisma.gateway.update({
      where: { id: gatewayId },
      data: { lastHealthStatus: status, lastCheckedAt: now, lastLatencyMs: latencyMs, lastError: error },
    });

    if (emitHealthUpdate) {
      emitHealthUpdate(tenantId, { gatewayId, status, latencyMs, error, checkedAt: now.toISOString() });
    }

    // Emit tunnel metrics if we have an active connection
    if (connected && info && emitTunnelMetricsUpdate) {
      emitTunnelMetricsUpdate(tenantId, {
        gatewayId,
        connectedAt: info.connectedAt.toISOString(),
        uptimeMs: now.getTime() - info.connectedAt.getTime(),
        rttMs: info.pingPongLatency ?? null,
        activeStreams: info.activeStreams,
        bytesTransferred: info.bytesTransferred,
        agentHealthy: info.heartbeatMetadata?.healthy ?? null,
        checkedAt: now.toISOString(),
      });
    }
  } catch (err) {
    log.error(`Tunnel probe failed for gateway ${gatewayId}:`, (err as Error).message);
  }
}

export function startTunnelMonitor(gatewayId: string, tenantId: string, intervalMs: number) {
  stopMonitor(gatewayId);

  log.info(`Starting tunnel-based monitor for ${gatewayId} (every ${intervalMs}ms)`);

  probeViaTunnel(gatewayId, tenantId);

  const handle = setInterval(() => {
    probeViaTunnel(gatewayId, tenantId);
  }, intervalMs);

  monitors.set(gatewayId, handle);
}

export async function startAllMonitors() {
  const gateways = await prisma.gateway.findMany({
    where: { monitoringEnabled: true },
    select: {
      id: true,
      host: true,
      port: true,
      tenantId: true,
      monitorIntervalMs: true,
      publishPorts: true,
      type: true,
      tunnelEnabled: true,
    },
  });

  const isTunnelGateway = (gw: { tunnelEnabled: boolean }) => gw.tunnelEnabled;

  const isPublishPortsManaged = (gw: { publishPorts: boolean; type: string; tunnelEnabled: boolean }) =>
    !gw.tunnelEnabled && gw.publishPorts && (gw.type === 'MANAGED_SSH' || gw.type === 'GUACD');

  const tunnelBased = gateways.filter(isTunnelGateway);
  const instanceBased = gateways.filter(isPublishPortsManaged);
  type GwRow = (typeof gateways)[number];
  const probeable = gateways.filter(
    (gw: GwRow) => !isTunnelGateway(gw) && !isPublishPortsManaged(gw),
  );

  logger.info(
    `[gateway-monitor] Starting monitors for ${probeable.length} direct + ` +
    `${instanceBased.length} instance-based + ${tunnelBased.length} tunnel-based ` +
    `(${gateways.length} total)`,
  );

  for (const gw of probeable) {
    startMonitor(gw.id, gw.host, gw.port, gw.tenantId, gw.monitorIntervalMs);
  }

  for (const gw of instanceBased) {
    startInstanceMonitor(gw.id, gw.tenantId, gw.monitorIntervalMs);
  }

  for (const gw of tunnelBased) {
    startTunnelMonitor(gw.id, gw.tenantId, gw.monitorIntervalMs);
  }
}

export function stopAllMonitors() {
  log.info(`Stopping all monitors (${monitors.size} active)`);
  for (const [, handle] of monitors) {
    clearInterval(handle);
  }
  monitors.clear();
}
