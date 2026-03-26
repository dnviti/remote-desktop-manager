import prisma from '../lib/prisma';
import { AppError } from '../middleware/error.middleware';
import { getConnectionCredentials } from './connection.service';
import * as sessionService from './session.service';
import * as auditService from './audit.service';
import * as dbQueryExecutor from './dbQueryExecutor.service';
import { selectInstance } from './loadBalancer.service';
import { getDefaultGateway } from './gateway.service';
import { isTunnelConnected, createTcpProxy } from './tunnel.service';
import { logger } from '../utils/logger';
import type { DbSettings, DbSessionConfig } from '../types';

const log = logger.child('db-proxy');

// Default ports for database protocols
const DEFAULT_DB_PORTS: Record<string, number> = {
  postgresql: 5432,
  mysql: 3306,
  mongodb: 27017,
  oracle: 1521,
  mssql: 1433,
  db2: 50000,
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
  sessionConfig?: DbSessionConfig;
}): Promise<DbProxySessionResult> {
  const { userId, connectionId, tenantId, ipAddress, overrideUsername, overridePassword, sessionConfig } = params;

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
    // No gateway — all connections require a gateway
    auditService.log({
      userId,
      action: 'SESSION_BLOCKED',
      targetType: 'Connection',
      targetId: connectionId,
      details: { reason: 'no_gateway_available', protocol: 'DATABASE', dbProtocol },
      ipAddress,
    });
    throw new AppError(
      'No gateway available. A connected gateway is required for all connections. Deploy and connect a DB_PROXY gateway to enable database sessions.',
      503,
    );
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
      resolvedHost: proxyHost,
      resolvedPort: proxyPort,
      // Propagate DB-specific settings so pool creation can reconstruct DbSettings
      ...(dbSettings.oracleConnectionType && { oracleConnectionType: dbSettings.oracleConnectionType }),
      ...(dbSettings.oracleSid && { oracleSid: dbSettings.oracleSid }),
      ...(dbSettings.oracleServiceName && { oracleServiceName: dbSettings.oracleServiceName }),
      ...(dbSettings.oracleRole && { oracleRole: dbSettings.oracleRole }),
      ...(dbSettings.oracleTnsAlias && { oracleTnsAlias: dbSettings.oracleTnsAlias }),
      ...(dbSettings.oracleTnsDescriptor && { oracleTnsDescriptor: dbSettings.oracleTnsDescriptor }),
      ...(dbSettings.oracleConnectString && { oracleConnectString: dbSettings.oracleConnectString }),
      ...(dbSettings.mssqlInstanceName && { mssqlInstanceName: dbSettings.mssqlInstanceName }),
      ...(dbSettings.mssqlAuthMode && { mssqlAuthMode: dbSettings.mssqlAuthMode }),
      ...(dbSettings.db2DatabaseAlias && { db2DatabaseAlias: dbSettings.db2DatabaseAlias }),
      ...(sessionConfig && { sessionConfig }),
    },
    routingDecision,
  });

  // Eagerly test database connectivity so the client gets an immediate error
  // instead of a false "connected" state when the target DB is unreachable.
  try {
    await dbQueryExecutor.testConnection({
      sessionId,
      connectionId,
      userId,
      tenantId: tenantId ?? '',
      metadata: {
        host: conn.host,
        port: conn.port,
        dbProtocol,
        databaseName,
        username,
        resolvedHost: proxyHost,
        resolvedPort: proxyPort,
        ...(dbSettings.oracleConnectionType && { oracleConnectionType: dbSettings.oracleConnectionType }),
        ...(dbSettings.oracleSid && { oracleSid: dbSettings.oracleSid }),
        ...(dbSettings.oracleServiceName && { oracleServiceName: dbSettings.oracleServiceName }),
        ...(dbSettings.oracleRole && { oracleRole: dbSettings.oracleRole }),
        ...(dbSettings.oracleTnsAlias && { oracleTnsAlias: dbSettings.oracleTnsAlias }),
        ...(dbSettings.oracleTnsDescriptor && { oracleTnsDescriptor: dbSettings.oracleTnsDescriptor }),
        ...(dbSettings.oracleConnectString && { oracleConnectString: dbSettings.oracleConnectString }),
        ...(dbSettings.mssqlInstanceName && { mssqlInstanceName: dbSettings.mssqlInstanceName }),
        ...(dbSettings.mssqlAuthMode && { mssqlAuthMode: dbSettings.mssqlAuthMode }),
        ...(dbSettings.db2DatabaseAlias && { db2DatabaseAlias: dbSettings.db2DatabaseAlias }),
        ...(sessionConfig && { sessionConfig }),
      },
    });
  } catch (err) {
    // Connectivity check failed — clean up the session record
    await sessionService.endSession(sessionId, 'connectivity_check_failed');
    const msg = err instanceof Error ? err.message : 'Unknown error';
    log.warn(`DB connectivity check failed for session ${sessionId}: ${msg}`);

    if (err instanceof AppError) throw err;

    // Classify common driver errors into user-friendly responses
    const lower = msg.toLowerCase();
    if (lower.includes('econnrefused') || lower.includes('connection refused')) {
      throw new AppError('Database unreachable — connection refused', 502);
    }
    if (lower.includes('authentication') || lower.includes('password') || lower.includes('login failed') || lower.includes('access denied')) {
      throw new AppError('Database authentication failed', 401);
    }
    if (lower.includes('timeout') || lower.includes('etimedout') || lower.includes('timed out')) {
      throw new AppError('Database connection timed out', 504);
    }
    throw new AppError(`Failed to connect to database: ${msg}`, 502);
  }

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

  await dbQueryExecutor.destroyPool(sessionId);
  await sessionService.endSession(sessionId, 'client_disconnect');
  log.info(`DB proxy session ${sessionId} ended`);
}
