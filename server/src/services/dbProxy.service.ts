import prisma from '../lib/prisma';
import { AppError } from '../middleware/error.middleware';
import { getConnectionCredentials } from './connection.service';
import * as sessionService from './session.service';
import * as auditService from './audit.service';
import * as dbQueryExecutor from './dbQueryExecutor.service';
import * as goDbSession from './goDbSession.service';
import { selectInstance } from './loadBalancer.service';
import { getDefaultGateway } from './gateway.service';
import { ensureTunnelConnected, createTcpProxy, closeTcpProxy } from './tunnel.service';
import { logger } from '../utils/logger';
import type { DbSettings, DbSessionConfig } from '../types';
import { config } from '../config';

const log = logger.child('db-proxy');


export interface DbProxySessionResult {
  sessionId: string;
  proxyHost: string;
  proxyPort: number;
  protocol: string;
  databaseName?: string;
}

function shouldUseGoDatabaseSessionRuntime(params: {
  dbProtocol?: string;
  sessionConfig?: DbSessionConfig;
  usesOverrideCredentials?: boolean;
}): boolean {
  void params.sessionConfig;
  return config.goQueryRunnerEnabled
    && params.dbProtocol === 'postgresql'
    && !params.usesOverrideCredentials
    && goDbSession.usesDelegatableDatabaseSessionConfig();
}

function buildSessionMetadata(params: {
  connHost: string;
  connPort: number;
  dbProtocol: string;
  databaseName?: string;
  username: string;
  resolvedHost: string;
  resolvedPort: number;
  dbSettings: DbSettings;
  sessionConfig?: DbSessionConfig;
  usesOverrideCredentials: boolean;
}): Record<string, unknown> {
  const {
    connHost,
    connPort,
    dbProtocol,
    databaseName,
    username,
    resolvedHost,
    resolvedPort,
    dbSettings,
    sessionConfig,
    usesOverrideCredentials,
  } = params;

  return {
    host: connHost,
    port: connPort,
    dbProtocol,
    databaseName,
    username,
    resolvedHost,
    resolvedPort,
    usesOverrideCredentials,
    ...(dbSettings.sslMode && { sslMode: dbSettings.sslMode }),
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
  };
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
  let tunnelProxyServer: import('net').Server | undefined;
  try {
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
    const usesOverrideCredentials = Boolean(overrideUsername && overridePassword);
    const useGoSessionRuntime = shouldUseGoDatabaseSessionRuntime({
      dbProtocol,
      sessionConfig,
      usesOverrideCredentials,
    });
    const useDirectPostgresPath = useGoSessionRuntime;

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
        if (!inst && !gateway.tunnelEnabled) {
          throw new AppError(
            'No healthy DB proxy instances available. The gateway may be scaling — please try again.',
            503,
          );
        }
        if (inst) {
          proxyHost = inst.host;
          proxyPort = inst.port;
          selectedInstanceId = inst.id;
          routingDecision = {
            strategy: inst.strategy,
            candidateCount: inst.candidateCount,
            selectedSessionCount: inst.selectedSessionCount,
          };
        }
      }

      // During the Go query-runner migration, PostgreSQL sessions connect
      // directly to the target database while keeping the gateway selection
      // metadata for control-plane visibility and future placement.
      if (useDirectPostgresPath) {
        proxyHost = conn.host;
        proxyPort = conn.port;
      } else if (gateway.tunnelEnabled) {
        if (!await ensureTunnelConnected(gateway.id)) {
          throw new AppError('Gateway tunnel is disconnected — the gateway may be unreachable', 503);
        }
        const targetPort = proxyPort;
        const { server, localPort } = await createTcpProxy(gateway.id, '127.0.0.1', targetPort);
        tunnelProxyServer = server;
        proxyHost = config.goQueryRunnerEnabled ? config.internalServerHost : '127.0.0.1';
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
    let password: string;

    if (overrideUsername && overridePassword) {
      username = overrideUsername;
      password = overridePassword;
    } else {
      const creds = await getConnectionCredentials(userId, connectionId, tenantId);
      username = creds.username;
      password = creds.password;
    }
    const sessionMetadata = buildSessionMetadata({
      connHost: conn.host,
      connPort: conn.port,
      dbProtocol,
      databaseName,
      username,
      resolvedHost: proxyHost,
      resolvedPort: proxyPort,
      dbSettings,
      sessionConfig,
      usesOverrideCredentials,
    });

    let sessionId: string;

    if (useGoSessionRuntime) {
      const issued = await goDbSession.issueDatabaseSession({
        userId,
        connectionId,
        gatewayId: gateway?.id,
        instanceId: selectedInstanceId,
        protocol: 'DATABASE',
        ipAddress,
        username,
        proxyHost,
        proxyPort,
        databaseName,
        sessionMetadata,
        routingDecision,
        target: {
          protocol: 'postgresql',
          host: proxyHost,
          port: proxyPort,
          database: sessionConfig?.activeDatabase || databaseName,
          sslMode: dbSettings.sslMode,
          username,
          password,
          sessionConfig,
        },
      });
      sessionId = issued.sessionId;
      proxyHost = issued.proxyHost;
      proxyPort = issued.proxyPort;
    } else {
      // Close stale sessions for this user+connection
      await sessionService.closeStaleSessionsForConnection(userId, connectionId, 'DATABASE');

      // Create persistent session record
      sessionId = await sessionService.startSession({
        userId,
        connectionId,
        gatewayId: gateway?.id,
        instanceId: selectedInstanceId,
        protocol: 'DATABASE',
        ipAddress,
        metadata: sessionMetadata,
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
          metadata: sessionMetadata,
        });
      } catch (err) {
        await closeTcpProxy(tunnelProxyServer);
        await sessionService.endSession(sessionId, 'connectivity_check_failed');
        const msg = err instanceof Error ? err.message : 'Unknown error';
        log.warn(`DB connectivity check failed for session ${sessionId}: ${msg}`);

        if (err instanceof AppError) throw err;

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
    }

    log.info(`DB proxy session ${sessionId} created for connection ${connectionId} (${dbProtocol})`);

    if (!useGoSessionRuntime) {
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
    }

    return {
      sessionId,
      proxyHost,
      proxyPort,
      protocol: dbProtocol,
      databaseName,
    };
  } catch (err) {
    await closeTcpProxy(tunnelProxyServer);
    throw err;
  }
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

  const metadata = (session.metadata as Record<string, unknown>) ?? {};
  const sessionConfig = (metadata.sessionConfig as DbSessionConfig | undefined) ?? undefined;
  const useGoSessionRuntime = shouldUseGoDatabaseSessionRuntime({
    dbProtocol: typeof metadata.dbProtocol === 'string' ? metadata.dbProtocol : undefined,
    sessionConfig,
    usesOverrideCredentials: metadata.usesOverrideCredentials === true,
  });

  if (useGoSessionRuntime) {
    await goDbSession.endDatabaseSession(sessionId, { userId, reason: 'client_disconnect' });
  } else {
    await dbQueryExecutor.destroyPool(sessionId);
    await sessionService.endSession(sessionId, 'client_disconnect');
  }
  log.info(`DB proxy session ${sessionId} ended`);
}
