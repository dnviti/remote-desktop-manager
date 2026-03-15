import prisma, { LoadBalancingStrategy, ManagedInstanceStatus } from '../lib/prisma';
import { logger } from '../utils/logger';

const log = logger.child('load-balancer');

export interface SelectedInstance {
  id: string;
  host: string;
  port: number;
  containerName: string;
}

export interface RoutingDecision extends SelectedInstance {
  strategy: LoadBalancingStrategy;
  candidateCount: number;
  selectedSessionCount: number;
  sessionDistribution: Array<{ instanceId: string; sessions: number }>;
}

/**
 * Selects the best RUNNING + healthy instance for a managed gateway.
 * Returns null if no eligible instances exist (caller falls back to gateway host:port).
 */
export async function selectInstance(
  gatewayId: string,
  strategy: LoadBalancingStrategy,
): Promise<RoutingDecision | null> {
  // Fetch the parent gateway to check tunnel routing
  const gateway = await prisma.gateway.findUnique({
    where: { id: gatewayId },
    select: { tunnelEnabled: true },
  });

  const instances = await prisma.managedGatewayInstance.findMany({
    where: {
      gatewayId,
      status: ManagedInstanceStatus.RUNNING,
      healthStatus: 'healthy',
    },
    select: {
      id: true,
      host: true,
      port: true,
      containerName: true,
      tunnelProxyHost: true,
      tunnelProxyPort: true,
      _count: {
        select: {
          sessions: {
            where: { status: { not: 'CLOSED' } },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (instances.length === 0) {
    log.warn(`No healthy RUNNING instances for gateway ${gatewayId}`);
    return null;
  }

  let selected: (typeof instances)[number];

  if (strategy === 'LEAST_CONNECTIONS') {
    selected = instances.reduce((best, curr) =>
      curr._count.sessions < best._count.sessions ? curr : best,
    );
  } else {
    // ROUND_ROBIN: pick instance with fewest sessions, random tiebreak
    const minSessions = Math.min(...instances.map((i) => i._count.sessions));
    const candidates = instances.filter((i) => i._count.sessions === minSessions);
    selected = candidates[Math.floor(Math.random() * candidates.length)];
  }

  // For tunneled managed gateways, use the tunnel proxy address when available
  const useTunnel = gateway?.tunnelEnabled && selected.tunnelProxyHost != null && selected.tunnelProxyPort != null;
  const resolvedHost = useTunnel && selected.tunnelProxyHost != null ? selected.tunnelProxyHost : selected.host;
  const resolvedPort = useTunnel && selected.tunnelProxyPort != null ? selected.tunnelProxyPort : selected.port;

  log.debug(
    `Selected instance ${selected.id} (${resolvedHost}:${resolvedPort}) ` +
      `for gateway ${gatewayId} using ${strategy} (${selected._count.sessions} active sessions)` +
      (useTunnel ? ' [tunnel proxy]' : ''),
  );

  return {
    id: selected.id,
    host: resolvedHost,
    port: resolvedPort,
    containerName: selected.containerName,
    strategy,
    candidateCount: instances.length,
    selectedSessionCount: selected._count.sessions,
    sessionDistribution: instances.map((i) => ({ instanceId: i.id, sessions: i._count.sessions })),
  };
}
