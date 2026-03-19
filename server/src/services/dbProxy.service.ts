import prisma from '../lib/prisma';
import { AppError } from '../middleware/error.middleware';
import { getConnectionCredentials } from './connection.service';
import * as sessionService from './session.service';
import * as auditService from './audit.service';
import { selectInstance } from './loadBalancer.service';
import { getDefaultGateway } from './gateway.service';
import { isTunnelConnected, createTcpProxy } from './tunnel.service';
import { logger } from '../utils/logger';
import type { DbSettings } from '../types';

const log = logger.child('db-proxy');

// Default ports for database protocols
const DEFAULT_DB_PORTS: Record<string, number> = {
  postgresql: 5432,
  mysql: 3306,
  mongodb: 27017,
};

export interface DbProxySessionResult {
  sessionId: string;
  proxyHost: string;
  proxyPort: number;
  protocol: string;
  databaseName?: string;
}

/**
 * Creates a database proxy session.
 *
 * This resolves the connection credentials from the vault, selects a DB_PROXY
 * gateway instance via the load balancer, and registers an active session.
 * The proxy container handles the actual database wire protocol.
 */
export async function createDbProxySession(params: {
  userId: string;
  connectionId: string;
  tenantId?: string;
  ipAddress?: string;
  overrideUsername?: string;
  overridePassword?: string;
}): Promise<DbProxySessionResult> {
  const { userId, connectionId, tenantId, ipAddress, overrideUsername, overridePassword } = params;

  const conn = await prisma.connection.findUnique({
    where: { id: connectionId },
    include: {
      gateway: { select: { id: true, type: true, host: true, port: true, isManaged: true, lbStrategy: true, tunnelEnabled: true } },
    },
  });
  if (!conn) throw new AppError('Connection not found', 404);
  if (conn.type !== 'DATABASE') {
    throw new AppError('Not a DATABASE connection', 400);
  }

  const dbSettings = (conn.dbSettings as DbSettings | null) ?? { protocol: 'postgresql' };
  const dbProtocol = dbSettings.protocol ?? 'postgresql';
  const databaseName = dbSettings.databaseName;

  // Resolve gateway: explicit > tenant default > none
  const explicitGw = conn.gateway;
  const defaultGw = !explicitGw && tenantId ? await getDefaultGateway(tenantId, 'DB_PROXY') : null;
  const gatewayRef = explicitGw ?? defaultGw;

  // If we resolved a gateway, load the full row with tunnelEnabled
  const gateway = gatewayRef
    ? await prisma.gateway.findUnique({
        where: { id: gatewayRef.id },
        select: { id: true, type: true, host: true, port: true, isManaged: true, lbStrategy: true, tunnelEnabled: true },
      })
    : null;

  let proxyHost: string;
  let proxyPort: number;
  let selectedInstanceId: string | undefined;
  let routingDecision: { strategy: string; candidateCount: number; selectedSessionCount: number } | undefined;

  if (gateway) {
    if (gateway.type !== 'DB_PROXY') {
      throw new AppError('Connection gateway must be of type DB_PROXY for database connections', 400);
    }
    proxyHost = gateway.host;
    proxyPort = gateway.port;

    if (gateway.isManaged) {
      const inst = await selectInstance(gateway.id, gateway.lbStrategy);
      if (!inst) {
        throw new AppError(
          'No healthy DB proxy instances available. The gateway may be scaling — please try again.',
          503,
        );
      }
      proxyHost = inst.host;
      proxyPort = inst.port;
      selectedInstanceId = inst.id;
      routingDecision = {
        strategy: inst.strategy,
        candidateCount: inst.candidateCount,
        selectedSessionCount: inst.selectedSessionCount,
      };
    }

    // Tunnel routing
    if (gateway.tunnelEnabled) {
      if (!isTunnelConnected(gateway.id)) {
        throw new AppError('Gateway tunnel is disconnected — the gateway may be unreachable', 503);
      }
      const targetHost = proxyHost;
      const targetPort = proxyPort;
      const { localPort } = await createTcpProxy(gateway.id, targetHost, targetPort);
      proxyHost = '127.0.0.1';
      proxyPort = localPort;
    }
  } else {
    // No gateway — connect directly to the database host
    proxyHost = conn.host;
    proxyPort = conn.port || DEFAULT_DB_PORTS[dbProtocol] || 5432;
  }

  // Resolve credentials (password is verified but not stored in session metadata;
  // it is injected into the proxy container at the protocol level)
  let username: string;
  let _password: string;

  if (overrideUsername && overridePassword) {
    username = overrideUsername;
    _password = overridePassword;
  } else {
    const creds = await getConnectionCredentials(userId, connectionId, tenantId);
    username = creds.username;
    _password = creds.password;
  }
  // Ensure credentials were resolved (validates vault access)
  void _password;

  // Close stale sessions for this user+connection
  await sessionService.closeStaleSessionsForConnection(userId, connectionId, 'DATABASE');

  // Create persistent session record
  const sessionId = await sessionService.startSession({
    userId,
    connectionId,
    gatewayId: gateway?.id,
    instanceId: selectedInstanceId,
    protocol: 'DATABASE',
    ipAddress,
    metadata: {
      host: conn.host,
      port: conn.port,
      dbProtocol,
      databaseName,
      username,
    },
    routingDecision,
  });

  log.info(`DB proxy session ${sessionId} created for connection ${connectionId} (${dbProtocol})`);

  auditService.log({
    userId,
    action: 'SESSION_START',
    targetType: 'Connection',
    targetId: connectionId,
    details: {
      protocol: 'DATABASE',
      dbProtocol,
      databaseName,
      sessionId,
    },
    ipAddress,
    gatewayId: gateway?.id,
  });

  return {
    sessionId,
    proxyHost,
    proxyPort,
    protocol: dbProtocol,
    databaseName,
  };
}

/**
 * End a database proxy session.
 */
export async function endDbProxySession(
  userId: string,
  sessionId: string,
): Promise<void> {
  const session = await prisma.activeSession.findUnique({
    where: { id: sessionId },
  });
  if (!session || session.userId !== userId) {
    throw new AppError('Session not found', 404);
  }
  if (session.status === 'CLOSED') {
    throw new AppError('Session already closed', 410);
  }

  await sessionService.endSession(sessionId, 'client_disconnect');
  log.info(`DB proxy session ${sessionId} ended`);
}
