import prisma from '../lib/prisma';
import type { GatewayHealthStatus } from '../lib/prisma';
import { tcpProbe } from '../utils/tcpProbe';
import { logger } from '../utils/logger';

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
    logger.error(`[gateway-monitor] Probe failed for gateway ${gatewayId}:`, (err as Error).message);
  }
}

export function startMonitor(gatewayId: string, host: string, port: number, tenantId: string, intervalMs: number) {
  stopMonitor(gatewayId);

  logger.info(`[gateway-monitor] Starting monitor for ${gatewayId} (${host}:${port}, every ${intervalMs}ms)`);

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
    logger.info(`[gateway-monitor] Stopped monitor for ${gatewayId}`);
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
  stopMonitor(gatewayId);
  if (enabled) {
    startMonitor(gatewayId, host, port, tenantId, intervalMs);
  }
}

export async function startAllMonitors() {
  const gateways = await prisma.gateway.findMany({
    where: { monitoringEnabled: true },
    select: { id: true, host: true, port: true, tenantId: true, monitorIntervalMs: true },
  });

  logger.info(`[gateway-monitor] Starting monitors for ${gateways.length} gateway(s)`);

  for (const gw of gateways) {
    startMonitor(gw.id, gw.host, gw.port, gw.tenantId, gw.monitorIntervalMs);
  }
}

export function stopAllMonitors() {
  logger.info(`[gateway-monitor] Stopping all monitors (${monitors.size} active)`);
  for (const [, handle] of monitors) {
    clearInterval(handle);
  }
  monitors.clear();
}
