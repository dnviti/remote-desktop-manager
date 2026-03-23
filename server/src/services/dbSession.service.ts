import prisma from '../lib/prisma';
import { AppError } from '../middleware/error.middleware';
import { getConnectionCredentials } from './connection.service';
import { createDbProxySession, endDbProxySession } from './dbProxy.service';
import * as auditService from './audit.service';
import * as sqlFirewall from './sqlFirewall.service';
import * as dbAudit from './dbAudit.service';
import * as dataMasking from './dataMasking.service';
import * as dbQueryExecutor from './dbQueryExecutor.service';
import { config } from '../config';
import { logger } from '../utils/logger';
import type { DbSettings, TenantRoleType } from '../types';

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
}): Promise<DbSessionResult> {
  const { userId, connectionId, tenantId, ipAddress, overrideUsername, overridePassword } = params;

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
  const databaseName = dbSettings?.databaseName;
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

  // --- Execute query against target database ---
  const pool = await dbQueryExecutor.getOrCreatePool({
    sessionId,
    connectionId: session.connectionId,
    userId,
    tenantId,
    metadata: (session.metadata as Record<string, unknown>) ?? {},
  });

  const rawResult = await dbQueryExecutor.runQuery(
    pool,
    sql,
    config.dbQueryMaxRows,
    config.dbQueryTimeoutMs,
  );

  const executionTimeMs = rawResult.durationMs;

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
    include: { connection: { select: { id: true } } },
  });
  if (!session || session.userId !== userId) {
    throw new AppError('Session not found', 404);
  }
  if (session.status === 'CLOSED') {
    throw new AppError('Session already closed', 410);
  }

  const pool = await dbQueryExecutor.getOrCreatePool({
    sessionId,
    connectionId: session.connectionId,
    userId,
    tenantId,
    metadata: (session.metadata as Record<string, unknown>) ?? {},
  });

  return dbQueryExecutor.fetchSchema(pool);
}
