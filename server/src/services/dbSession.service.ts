import prisma from '../lib/prisma';
import { AppError } from '../middleware/error.middleware';
import { getConnectionCredentials } from './connection.service';
import { createDbProxySession, endDbProxySession } from './dbProxy.service';
import * as auditService from './audit.service';
import * as sqlFirewall from './sqlFirewall.service';
import * as dbAudit from './dbAudit.service';
import * as dataMasking from './dataMasking.service';
import * as dbRateLimit from './dbRateLimit.service';
import * as dbQueryExecutor from './dbQueryExecutor.service';
import * as dbIntrospection from './dbIntrospection.service';
import * as goQueryRunner from './goQueryRunner.service';
import * as goDbSession from './goDbSession.service';
import { config } from '../config';
import { logger } from '../utils/logger';
import type { DbSettings, DbSessionConfig, TenantRoleType } from '../types';
import type { ExplainResult } from './dbQueryExecutor.service';
import type { IntrospectionResult, IntrospectionType } from './dbIntrospection.service';

const log = logger.child('db-session');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DbSessionResult {
  sessionId: string;
  proxyHost: string;
  proxyPort: number;
  protocol: string;
  databaseName?: string;
  username: string;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  durationMs: number;
  truncated: boolean;
}

export interface SchemaInfo {
  tables: TableInfo[];
  views?: ViewInfo[];
  functions?: RoutineInfo[];
  procedures?: RoutineInfo[];
  triggers?: TriggerInfo[];
  sequences?: SequenceInfo[];
  packages?: PackageInfo[];
  types?: DbTypeInfo[];
}

export interface TableInfo {
  name: string;
  schema: string;
  columns: ColumnInfo[];
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
}

export interface ViewInfo {
  name: string;
  schema: string;
  materialized?: boolean;
}

export interface RoutineInfo {
  name: string;
  schema: string;
  returnType?: string;
}

export interface TriggerInfo {
  name: string;
  schema: string;
  tableName: string;
  event: string;
  timing: string;
}

export interface SequenceInfo {
  name: string;
  schema: string;
}

export interface PackageInfo {
  name: string;
  schema: string;
  hasBody: boolean;
}

export interface DbTypeInfo {
  name: string;
  schema: string;
  kind: string;
}

function shouldUseGoExecuteRunner(params: {
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

function shouldUseGoSchemaRunner(params: {
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

function shouldUseGoExplainRunner(params: {
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

function shouldUseGoIntrospectionRunner(params: {
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

function resolveSessionTarget(metadata: Record<string, unknown>, fallbackHost: string, fallbackPort: number): { host: string; port: number } {
  const resolvedHost = typeof metadata.resolvedHost === 'string' && metadata.resolvedHost.length > 0
    ? metadata.resolvedHost
    : fallbackHost;
  const resolvedPort = typeof metadata.resolvedPort === 'number' && Number.isFinite(metadata.resolvedPort)
    ? metadata.resolvedPort
    : fallbackPort;
  return { host: resolvedHost, port: resolvedPort };
}

async function buildGoDatabaseTarget(params: {
  userId: string;
  tenantId: string;
  connectionId: string;
  sessionMetadata: Record<string, unknown>;
  connectionHost: string;
  connectionPort: number;
  dbSettings?: DbSettings;
  sessionConfig?: DbSessionConfig;
}) {
  const creds = await getConnectionCredentials(params.userId, params.connectionId, params.tenantId);
  const target = resolveSessionTarget(params.sessionMetadata, params.connectionHost, params.connectionPort);
  const effectiveSessionConfig = params.sessionConfig ?? (params.sessionMetadata.sessionConfig as DbSessionConfig | undefined);
  return {
    protocol: 'postgresql' as const,
    host: target.host,
    port: target.port,
    database: effectiveSessionConfig?.activeDatabase || params.dbSettings?.databaseName,
    sslMode: params.dbSettings?.sslMode,
    username: creds.username,
    password: creds.password,
    sessionConfig: effectiveSessionConfig,
  };
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

/**
 * Create a database session by delegating to the DB proxy service and returning
 * the session metadata alongside resolved credentials for the client.
 */
export async function createSession(params: {
  userId: string;
  connectionId: string;
  tenantId?: string;
  ipAddress?: string;
  overrideUsername?: string;
  overridePassword?: string;
  sessionConfig?: DbSessionConfig;
}): Promise<DbSessionResult> {
  const { userId, connectionId, tenantId, ipAddress, overrideUsername, overridePassword, sessionConfig } = params;

  // Fetch connection to extract DB settings
  const conn = await prisma.connection.findUnique({
    where: { id: connectionId },
  });
  if (!conn) throw new AppError('Connection not found', 404);
  if (conn.type !== 'DATABASE') {
    throw new AppError('Not a DATABASE connection', 400);
  }

  const dbSettings = (conn.dbSettings as DbSettings | null) ?? { protocol: 'postgresql' };

  // Resolve credentials for the client-side connection info
  let username: string;
  if (overrideUsername) {
    username = overrideUsername;
  } else {
    const creds = await getConnectionCredentials(userId, connectionId, tenantId);
    username = creds.username;
  }

  const proxyResult = await createDbProxySession({
    userId,
    connectionId,
    tenantId,
    ipAddress,
    overrideUsername,
    overridePassword,
    sessionConfig,
  });

  log.info(`DB session ${proxyResult.sessionId} created for connection ${connectionId}`);

  return {
    sessionId: proxyResult.sessionId,
    proxyHost: proxyResult.proxyHost,
    proxyPort: proxyResult.proxyPort,
    protocol: proxyResult.protocol,
    databaseName: proxyResult.databaseName ?? dbSettings.databaseName,
    username,
  };
}

/**
 * End a database session.
 */
export async function endSession(userId: string, sessionId: string): Promise<void> {
  await endDbProxySession(userId, sessionId);
  log.info(`DB session ${sessionId} ended by user ${userId}`);
}

/**
 * Send a heartbeat for a database session to keep it alive.
 */
export async function heartbeat(sessionId: string, userId: string): Promise<void> {
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
  if (shouldUseGoExecuteRunner({
    dbProtocol: typeof metadata.dbProtocol === 'string' ? metadata.dbProtocol : undefined,
    sessionConfig,
    usesOverrideCredentials: metadata.usesOverrideCredentials === true,
  })) {
    await goDbSession.heartbeatDatabaseSession(sessionId, { userId });
    return;
  }

  await prisma.activeSession.update({
    where: { id: sessionId },
    data: { lastActivityAt: new Date() },
  });
}

/**
 * Execute a SQL query against the database connection.
 *
 * Validates the session, evaluates SQL firewall rules, and records
 * query-level audit events. The actual query execution happens through
 * the DB proxy gateway — this endpoint enforces security policy and
 * provides the audit trail. If a firewall rule blocks the query, it is
 * rejected with a 403 before reaching the proxy.
 */
export async function executeQuery(params: {
  userId: string;
  tenantId: string;
  tenantRole?: TenantRoleType;
  sessionId: string;
  sql: string;
  ipAddress?: string;
}): Promise<QueryResult> {
  const { userId, tenantId, tenantRole, sessionId, sql, ipAddress } = params;

  const session = await prisma.activeSession.findUnique({
    where: { id: sessionId },
    include: { connection: { select: { id: true, name: true, host: true, port: true, dbSettings: true } } },
  });
  if (!session || session.userId !== userId) {
    throw new AppError('Session not found', 404);
  }
  if (session.status === 'CLOSED') {
    throw new AppError('Session already closed', 410);
  }

  const startTime = Date.now();
  const dbSettings = (session.connection.dbSettings as DbSettings | null) ?? undefined;
  const sessionMetadata = (session.metadata as Record<string, unknown>) ?? {};
  const sessionConfig = (sessionMetadata.sessionConfig as DbSessionConfig | undefined) ?? undefined;
  const databaseName = sessionConfig?.activeDatabase || dbSettings?.databaseName;
  const tablesAccessed = dbAudit.extractTables(sql);
  const queryType = dbAudit.classifyQuery(sql);

  // --- Role-based query restriction ---
  // Non-operator users (MEMBER, CONSULTANT, AUDITOR, GUEST) are restricted to SELECT-only.
  const WRITE_ROLES = new Set(['OPERATOR', 'ADMIN', 'OWNER']);
  if (queryType !== 'SELECT' && (!tenantRole || !WRITE_ROLES.has(tenantRole))) {
    const blockReason = `${queryType} queries require OPERATOR role or above`;

    dbAudit.interceptQuery({
      userId,
      connectionId: session.connectionId,
      tenantId,
      queryText: sql,
      blocked: true,
      blockReason,
    });

    auditService.log({
      userId,
      action: 'DB_QUERY_BLOCKED',
      targetType: 'DatabaseQuery',
      targetId: session.connectionId,
      details: { sessionId, protocol: 'DATABASE', queryType, blockReason },
      ipAddress,
    });

    throw new AppError(blockReason, 403);
  }

  // --- SQL Firewall enforcement ---
  const firewallResult = await sqlFirewall.evaluateQuery(
    tenantId,
    sql,
    databaseName,
    tablesAccessed[0], // primary table for scope matching
  );

  if (!firewallResult.allowed) {
    const blockReason = firewallResult.matchedRule
      ? `Blocked by firewall rule: ${firewallResult.matchedRule.name}`
      : 'Blocked by SQL firewall';

    // Audit the blocked query
    dbAudit.interceptQuery({
      userId,
      connectionId: session.connectionId,
      tenantId,
      queryText: sql,
      blocked: true,
      blockReason,
    });

    auditService.log({
      userId,
      action: 'DB_QUERY_BLOCKED',
      targetType: 'DatabaseQuery',
      targetId: session.connectionId,
      details: {
        sessionId,
        protocol: 'DATABASE',
        queryType,
        blockReason,
        firewallRule: firewallResult.matchedRule?.name,
      },
      ipAddress,
    });

    throw new AppError(blockReason, 403);
  }

  // --- Audit firewall ALERT/LOG matches (query allowed but rule triggered) ---
  const firewallNote = firewallResult.matchedRule
    ? `Firewall ${firewallResult.action}: ${firewallResult.matchedRule.name}`
    : undefined;

  if (firewallResult.matchedRule && firewallResult.action !== 'BLOCK') {
    auditService.log({
      userId,
      action: 'DB_QUERY_FIREWALL_ALERT',
      targetType: 'DatabaseQuery',
      targetId: session.connectionId,
      details: {
        sessionId,
        protocol: 'DATABASE',
        queryType,
        tablesAccessed,
        firewallAction: firewallResult.action,
        firewallRule: firewallResult.matchedRule.name,
      },
      ipAddress,
    });
  }

  // --- Rate limit enforcement ---
  const rateLimitResult = await dbRateLimit.evaluateRateLimit(
    userId,
    tenantId,
    queryType,
    tenantRole,
    databaseName,
    tablesAccessed[0], // primary table for scope matching
  );

  if (!rateLimitResult.allowed && rateLimitResult.policy) {
    const blockReason = `Rate limit exceeded: ${rateLimitResult.policy.name}`;

    dbAudit.interceptQuery({
      userId,
      connectionId: session.connectionId,
      tenantId,
      queryText: sql,
      blocked: true,
      blockReason,
    });

    auditService.log({
      userId,
      action: 'DB_QUERY_BLOCKED',
      targetType: 'DatabaseQuery',
      targetId: session.connectionId,
      details: {
        sessionId,
        protocol: 'DATABASE',
        queryType,
        blockReason,
        rateLimitPolicy: rateLimitResult.policy.name,
        retryAfterMs: rateLimitResult.retryAfterMs,
      },
      ipAddress,
    });

    const err = new AppError(blockReason, 429);
    throw err;
  }

  // Log rate limit trigger for LOG_ONLY policies (query is allowed but was actually over-limit)
  if (rateLimitResult.policy && rateLimitResult.retryAfterMs > 0) {
    auditService.log({
      userId,
      action: 'DB_QUERY_RATE_LIMITED',
      targetType: 'DatabaseQuery',
      targetId: session.connectionId,
      details: {
        sessionId,
        protocol: 'DATABASE',
        queryType,
        rateLimitPolicy: rateLimitResult.policy.name,
        action: rateLimitResult.policy.action,
        remaining: rateLimitResult.remaining,
      },
      ipAddress,
    });
  }

  // --- Execute query against target database ---
  const dbProtocol = dbSettings?.protocol;
  const useGoExecuteRunner = shouldUseGoExecuteRunner({
    dbProtocol,
    sessionConfig,
    usesOverrideCredentials: sessionMetadata.usesOverrideCredentials === true,
  });

  let pool: Awaited<ReturnType<typeof dbQueryExecutor.getOrCreatePool>> | undefined;
  let rawResult: QueryResult;

  if (useGoExecuteRunner) {
    rawResult = await goQueryRunner.executeQuery({
      sql,
      maxRows: config.dbQueryMaxRows,
      target: await buildGoDatabaseTarget({
        userId,
        tenantId,
        connectionId: session.connectionId,
        sessionMetadata,
        connectionHost: session.connection.host,
        connectionPort: session.connection.port,
        dbSettings,
        sessionConfig,
      }),
    });
  } else {
    pool = await dbQueryExecutor.getOrCreatePool({
      sessionId,
      connectionId: session.connectionId,
      userId,
      tenantId,
      metadata: sessionMetadata,
    });

    rawResult = await dbQueryExecutor.runQuery(
      pool,
      sql,
      config.dbQueryMaxRows,
      config.dbQueryTimeoutMs,
    );
  }

  const executionTimeMs = rawResult.durationMs;

  // --- Best-effort execution plan capture (for audit log) ---
  let executionPlanJson: unknown = undefined;
  const unsupportedProtocols = new Set(['mongodb', 'db2']);
  if (useGoExecuteRunner) {
    try {
      const explainResult = await goQueryRunner.explainQuery({
        sql,
        target: await buildGoDatabaseTarget({
          userId,
          tenantId,
          connectionId: session.connectionId,
          sessionMetadata,
          connectionHost: session.connection.host,
          connectionPort: session.connection.port,
          dbSettings,
          sessionConfig,
        }),
      });
      if (explainResult.supported) {
        executionPlanJson = explainResult;
      }
    } catch {
      // Execution plan capture is best-effort; never fail the query
    }
  } else if (pool && !unsupportedProtocols.has(pool.protocol)) {
    try {
      const explainResult = await dbQueryExecutor.runExplain(pool, sql);
      if (explainResult.supported) {
        executionPlanJson = explainResult;
      }
    } catch {
      // Execution plan capture is best-effort; never fail the query
    }
  }

  // --- Data masking ---
  const maskingPolicies = await dataMasking.getActivePolicies(tenantId);
  const maskedColumns = dataMasking.findMaskedColumns(
    maskingPolicies,
    rawResult.columns,
    tenantRole,
    databaseName,
    tablesAccessed[0],
  );
  const rows = maskedColumns.length > 0
    ? rawResult.rows.map((row) => dataMasking.maskRow(row, maskedColumns))
    : rawResult.rows;

  // --- Audit the executed query (includes firewall match info) ---
  dbAudit.interceptQuery({
    userId,
    connectionId: session.connectionId,
    tenantId,
    queryText: sql,
    blocked: false,
    blockReason: firewallNote,
    rowsAffected: rawResult.rowCount,
    executionTimeMs,
    executionPlan: executionPlanJson,
  });

  const totalDurationMs = Date.now() - startTime;

  auditService.log({
    userId,
    action: 'DB_QUERY_EXECUTED',
    targetType: 'DatabaseQuery',
    targetId: session.connectionId,
    details: {
      sessionId,
      protocol: 'DATABASE',
      queryType,
      tablesAccessed,
      rowsAffected: rawResult.rowCount,
      executionTimeMs,
      totalDurationMs,
      firewallAction: firewallResult.action ?? undefined,
      firewallRule: firewallResult.matchedRule?.name,
    },
    ipAddress,
  });

  // Update last activity
  await prisma.activeSession.update({
    where: { id: sessionId },
    data: { lastActivityAt: new Date() },
  });

  return {
    columns: rawResult.columns,
    rows,
    rowCount: rawResult.rowCount,
    durationMs: executionTimeMs,
    truncated: rawResult.truncated,
  };
}

/**
 * Fetch schema information for a database session.
 * Returns table and column metadata for the schema browser.
 */
export async function getSchema(userId: string, sessionId: string, tenantId: string): Promise<SchemaInfo> {
  const session = await prisma.activeSession.findUnique({
    where: { id: sessionId },
    include: { connection: { select: { id: true, host: true, port: true, dbSettings: true } } },
  });
  if (!session || session.userId !== userId) {
    throw new AppError('Session not found', 404);
  }
  if (session.status === 'CLOSED') {
    throw new AppError('Session already closed', 410);
  }

  const sessionMetadata = (session.metadata as Record<string, unknown>) ?? {};
  const dbSettings = (session.connection.dbSettings as DbSettings | null) ?? undefined;
  const sessionConfig = (sessionMetadata.sessionConfig as DbSessionConfig | undefined) ?? undefined;

  if (shouldUseGoSchemaRunner({
    dbProtocol: dbSettings?.protocol,
    sessionConfig,
    usesOverrideCredentials: sessionMetadata.usesOverrideCredentials === true,
  })) {
    return await goQueryRunner.fetchSchema({
      target: await buildGoDatabaseTarget({
        userId,
        tenantId,
        connectionId: session.connectionId,
        sessionMetadata,
        connectionHost: session.connection.host,
        connectionPort: session.connection.port,
        dbSettings,
        sessionConfig,
      }),
    });
  }

  const pool = await dbQueryExecutor.getOrCreatePool({
    sessionId,
    connectionId: session.connectionId,
    userId,
    tenantId,
    metadata: sessionMetadata,
  });

  return dbQueryExecutor.fetchSchema(pool);
}

/**
 * Get the execution plan for a SQL query via the database's native EXPLAIN.
 */
export async function getExecutionPlan(params: {
  userId: string;
  tenantId: string;
  tenantRole?: TenantRoleType;
  sessionId: string;
  sql: string;
  ipAddress?: string;
}): Promise<ExplainResult> {
  const { userId, tenantId, tenantRole, sessionId, sql, ipAddress } = params;

  const session = await prisma.activeSession.findUnique({
    where: { id: sessionId },
    include: { connection: { select: { id: true, host: true, port: true, dbSettings: true } } },
  });
  if (!session || session.userId !== userId) {
    throw new AppError('Session not found', 404);
  }
  if (session.status === 'CLOSED') {
    throw new AppError('Session already closed', 410);
  }

  const dbSettings = (session.connection.dbSettings as DbSettings | null) ?? undefined;
  const sessionMetadata = (session.metadata as Record<string, unknown>) ?? {};
  const sessionConfig = (sessionMetadata.sessionConfig as DbSessionConfig | undefined) ?? undefined;
  const databaseName = sessionConfig?.activeDatabase || dbSettings?.databaseName;
  const queryType = dbAudit.classifyQuery(sql);
  const tablesAccessed = dbAudit.extractTables(sql);

  // --- Role-based query restriction (same as executeQuery) ---
  const WRITE_ROLES = new Set(['OPERATOR', 'ADMIN', 'OWNER']);
  if (queryType !== 'SELECT' && (!tenantRole || !WRITE_ROLES.has(tenantRole))) {
    const blockReason = `EXPLAIN for ${queryType} queries requires OPERATOR role or above`;
    auditService.log({
      userId,
      action: 'DB_QUERY_BLOCKED',
      targetType: 'DatabaseQuery',
      targetId: session.connectionId,
      details: { sessionId, protocol: 'DATABASE', queryType, blockReason, context: 'explain' },
      ipAddress,
    });
    throw new AppError(blockReason, 403);
  }

  // --- SQL Firewall enforcement ---
  const firewallResult = await sqlFirewall.evaluateQuery(
    tenantId,
    sql,
    databaseName,
    tablesAccessed[0],
  );

  if (!firewallResult.allowed) {
    const blockReason = firewallResult.matchedRule
      ? `Blocked by firewall rule: ${firewallResult.matchedRule.name}`
      : 'Blocked by SQL firewall';
    auditService.log({
      userId,
      action: 'DB_QUERY_BLOCKED',
      targetType: 'DatabaseQuery',
      targetId: session.connectionId,
      details: { sessionId, protocol: 'DATABASE', queryType, blockReason, context: 'explain' },
      ipAddress,
    });
    throw new AppError(blockReason, 403);
  }

  let protocol = dbSettings?.protocol ?? 'postgresql';
  let result: ExplainResult;

  if (shouldUseGoExplainRunner({
    dbProtocol: dbSettings?.protocol,
    sessionConfig,
    usesOverrideCredentials: sessionMetadata.usesOverrideCredentials === true,
  })) {
    result = await goQueryRunner.explainQuery({
      sql,
      target: await buildGoDatabaseTarget({
        userId,
        tenantId,
        connectionId: session.connectionId,
        sessionMetadata,
        connectionHost: session.connection.host,
        connectionPort: session.connection.port,
        dbSettings,
        sessionConfig,
      }),
    });
  } else {
    const pool = await dbQueryExecutor.getOrCreatePool({
      sessionId,
      connectionId: session.connectionId,
      userId,
      tenantId,
      metadata: sessionMetadata,
    });

    protocol = pool.protocol;
    result = await dbQueryExecutor.runExplain(pool, sql);
  }

  // Audit the plan request
  auditService.log({
    userId,
    action: 'DB_QUERY_PLAN_REQUESTED',
    targetType: 'DatabaseQuery',
    targetId: session.connectionId,
    details: { sessionId, protocol, supported: result.supported, queryType },
    ipAddress,
  });

  return result;
}

/**
 * Perform database introspection (indexes, statistics, foreign keys, etc.)
 * via the active proxy session.
 */
export async function introspectDatabase(params: {
  userId: string;
  tenantId: string;
  tenantRole?: TenantRoleType;
  sessionId: string;
  type: IntrospectionType;
  target?: string;
  ipAddress?: string;
}): Promise<IntrospectionResult> {
  const { userId, tenantId, tenantRole, sessionId, type, target, ipAddress } = params;

  // --- Role-based restriction: introspection is limited to OPERATOR/ADMIN/OWNER ---
  const INTROSPECTION_ROLES = new Set(['OPERATOR', 'ADMIN', 'OWNER']);
  if (!tenantRole || !INTROSPECTION_ROLES.has(tenantRole)) {
    throw new AppError('Database introspection requires OPERATOR role or above', 403);
  }

  const session = await prisma.activeSession.findUnique({
    where: { id: sessionId },
    include: { connection: { select: { id: true, host: true, port: true, dbSettings: true } } },
  });
  if (!session || session.userId !== userId) {
    throw new AppError('Session not found', 404);
  }
  if (session.status === 'CLOSED') {
    throw new AppError('Session already closed', 410);
  }

  const sessionMetadata = (session.metadata as Record<string, unknown>) ?? {};
  const dbSettings = (session.connection.dbSettings as DbSettings | null) ?? undefined;
  const sessionConfig = (sessionMetadata.sessionConfig as DbSessionConfig | undefined) ?? undefined;

  let protocol = dbSettings?.protocol ?? 'postgresql';
  let result: IntrospectionResult;

  if (shouldUseGoIntrospectionRunner({
    dbProtocol: dbSettings?.protocol,
    sessionConfig,
    usesOverrideCredentials: sessionMetadata.usesOverrideCredentials === true,
  })) {
    result = await goQueryRunner.introspectQuery({
      type,
      target: type === 'database_version' ? undefined : (target ?? ''),
      db: await buildGoDatabaseTarget({
        userId,
        tenantId,
        connectionId: session.connectionId,
        sessionMetadata,
        connectionHost: session.connection.host,
        connectionPort: session.connection.port,
        dbSettings,
        sessionConfig,
      }),
    });
  } else {
    const pool = await dbQueryExecutor.getOrCreatePool({
      sessionId,
      connectionId: session.connectionId,
      userId,
      tenantId,
      metadata: sessionMetadata,
    });

    protocol = pool.protocol;
    result = await dbIntrospection.introspect(pool, type, target ?? '');
  }

  // Audit the introspection request
  auditService.log({
    userId,
    action: 'DB_INTROSPECTION_REQUESTED',
    targetType: 'DatabaseQuery',
    targetId: session.connectionId,
    details: { sessionId, protocol, introspectionType: type, target: target ?? '' },
    ipAddress,
  });

  return result;
}

// ---------------------------------------------------------------------------
// Session configuration — runtime session-level parameters
// ---------------------------------------------------------------------------

/**
 * Update session-level configuration (timezone, search path, encoding, etc.).
 * Destroys the current pool and recreates it with the new settings so that
 * all future queries execute against a properly configured session.
 */
export async function updateSessionConfig(params: {
  userId: string;
  tenantId: string;
  tenantRole?: TenantRoleType;
  sessionId: string;
  sessionConfig: DbSessionConfig;
  ipAddress?: string;
}): Promise<{ applied: boolean; activeDatabase?: string; sessionConfig?: DbSessionConfig }> {
  const { userId, tenantId, tenantRole, sessionId, sessionConfig, ipAddress } = params;

  const session = await prisma.activeSession.findUnique({
    where: { id: sessionId },
    include: { connection: { select: { id: true, host: true, port: true, dbSettings: true } } },
  });
  if (!session || session.userId !== userId) {
    throw new AppError('Session not found', 404);
  }
  if (session.status === 'CLOSED') {
    throw new AppError('Session already closed', 410);
  }

  const dbSettings = (session.connection.dbSettings as DbSettings | null) ?? undefined;
  if (dbSettings?.protocol === 'mongodb') {
    throw new AppError('Session configuration is not supported for MongoDB', 400);
  }

  // initCommands require OPERATOR+ role
  const OPERATOR_ROLES = new Set(['OPERATOR', 'ADMIN', 'OWNER']);
  if (sessionConfig.initCommands?.length && (!tenantRole || !OPERATOR_ROLES.has(tenantRole))) {
    throw new AppError('Custom init commands require OPERATOR role or above', 403);
  }

  // Validate initCommands are safe SET/ALTER SESSION statements
  if (sessionConfig.initCommands) {
    for (const cmd of sessionConfig.initCommands) {
      const normalized = cmd.trim().toUpperCase();
      if (!normalized.startsWith('SET ') && !normalized.startsWith('ALTER SESSION ')) {
        throw new AppError('Init commands must be SET or ALTER SESSION statements', 400);
      }
    }
  }

  const metadata = (session.metadata as Record<string, unknown>) ?? {};
  const dbProtocol = dbSettings?.protocol;
  const useGoSessionRuntime = shouldUseGoExecuteRunner({
    dbProtocol,
    sessionConfig,
    usesOverrideCredentials: metadata.usesOverrideCredentials === true,
  });

  if (useGoSessionRuntime) {
    const nextTarget = await buildGoDatabaseTarget({
      userId,
      tenantId,
      connectionId: session.connectionId,
      sessionMetadata: metadata,
      connectionHost: session.connection.host,
      connectionPort: session.connection.port,
      dbSettings,
      sessionConfig,
    });

    const response = await goDbSession.updateDatabaseSessionConfig(sessionId, {
      userId,
      sessionConfig,
      target: nextTarget,
    });

    auditService.log({
      userId,
      action: 'DB_SESSION_CONFIG_UPDATED',
      targetType: 'DatabaseQuery',
      targetId: session.connectionId,
      details: {
        sessionId,
        protocol: 'postgresql',
        configKeys: Object.keys(sessionConfig).filter((k) => (sessionConfig as Record<string, unknown>)[k] !== undefined),
      },
      ipAddress,
    });

    log.info(`Session config updated for session ${sessionId}`);

    return {
      applied: response.applied,
      activeDatabase: response.activeDatabase,
      sessionConfig: response.sessionConfig ?? sessionConfig,
    };
  }

  // Destroy existing pool
  await dbQueryExecutor.destroyPool(sessionId);

  // Merge sessionConfig into session metadata
  metadata.sessionConfig = sessionConfig;

  await prisma.activeSession.update({
    where: { id: sessionId },
    data: {
      metadata: metadata as never,
      lastActivityAt: new Date(),
    },
  });

  // Recreate pool with new config to validate it works
  const pool = await dbQueryExecutor.getOrCreatePool({
    sessionId,
    connectionId: session.connectionId,
    userId,
    tenantId,
    metadata,
  });

  // Audit the config change
  auditService.log({
    userId,
    action: 'DB_SESSION_CONFIG_UPDATED',
    targetType: 'DatabaseQuery',
    targetId: session.connectionId,
    details: {
      sessionId,
      protocol: pool.protocol,
      configKeys: Object.keys(sessionConfig).filter((k) => (sessionConfig as Record<string, unknown>)[k] !== undefined),
    },
    ipAddress,
  });

  log.info(`Session config updated for session ${sessionId}`);

  return {
    applied: true,
    activeDatabase: pool.databaseName,
    sessionConfig,
  };
}

/**
 * Retrieve the current session configuration from session metadata.
 */
export async function getSessionConfig(userId: string, sessionId: string): Promise<DbSessionConfig> {
  const session = await prisma.activeSession.findUnique({
    where: { id: sessionId },
    select: { userId: true, metadata: true, connection: { select: { id: true, host: true, port: true, dbSettings: true } } },
  });
  if (!session || session.userId !== userId) {
    throw new AppError('Session not found', 404);
  }

  const metadata = (session.metadata as Record<string, unknown>) ?? {};
  const dbSettings = (session.connection?.dbSettings as DbSettings | null) ?? undefined;
  if (shouldUseGoExecuteRunner({
    dbProtocol: dbSettings?.protocol,
    sessionConfig: metadata.sessionConfig as DbSessionConfig | undefined,
    usesOverrideCredentials: metadata.usesOverrideCredentials === true,
  })) {
    return await goDbSession.getDatabaseSessionConfig(sessionId, userId);
  }
  return (metadata.sessionConfig as DbSessionConfig) ?? {};
}

// ---------------------------------------------------------------------------
// Query history — user-scoped, reads from DbAuditLog
// ---------------------------------------------------------------------------

export interface QueryHistoryEntry {
  id: string;
  queryText: string;
  queryType: string;
  executionTimeMs: number | null;
  rowsAffected: number | null;
  blocked: boolean;
  createdAt: Date;
}

export async function getQueryHistory(params: {
  userId: string;
  sessionId: string;
  limit?: number;
  search?: string;
}): Promise<QueryHistoryEntry[]> {
  const { userId, sessionId, search } = params;
  const limit = Math.min(params.limit ?? 50, 200);

  // Validate session ownership
  const session = await prisma.activeSession.findUnique({
    where: { id: sessionId },
    select: { userId: true, connectionId: true },
  });
  if (!session || session.userId !== userId) {
    throw new AppError('Session not found', 404);
  }

  const where: Record<string, unknown> = {
    userId,
    connectionId: session.connectionId,
  };

  if (search) {
    where.queryText = { contains: search, mode: 'insensitive' };
  }

  const rows = await prisma.dbAuditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      queryText: true,
      queryType: true,
      executionTimeMs: true,
      rowsAffected: true,
      blocked: true,
      createdAt: true,
    },
  });

  return rows;
}
