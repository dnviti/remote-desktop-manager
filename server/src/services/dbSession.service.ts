import prisma from '../lib/prisma';
import { AppError } from '../middleware/error.middleware';
import { getConnectionCredentials } from './connection.service';
import { createDbProxySession, endDbProxySession } from './dbProxy.service';
import * as auditService from './audit.service';
import { logger } from '../utils/logger';
import type { DbSettings } from '../types';

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
 * In this initial implementation, the server logs the query for audit purposes
 * and returns the query metadata. The actual query execution happens through
 * the DB proxy gateway, so this endpoint validates the session and records
 * query-level audit events.
 */
export async function executeQuery(params: {
  userId: string;
  sessionId: string;
  sql: string;
  ipAddress?: string;
}): Promise<QueryResult> {
  const { userId, sessionId, sql, ipAddress } = params;

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

  // Audit log the query execution
  auditService.log({
    userId,
    action: 'SESSION_START',
    targetType: 'DatabaseQuery',
    targetId: session.connectionId,
    details: {
      sessionId,
      protocol: 'DATABASE',
      queryPreview: sql.substring(0, 200),
      queryLength: sql.length,
    },
    ipAddress,
  });

  // Update last activity
  await prisma.activeSession.update({
    where: { id: sessionId },
    data: { lastActivityAt: new Date() },
  });

  const durationMs = Date.now() - startTime;

  // Return empty result set — actual query execution is handled client-side
  // via direct connection to the DB proxy. This endpoint provides audit trail
  // and session validation.
  return {
    columns: [],
    rows: [],
    rowCount: 0,
    durationMs,
  };
}

/**
 * Fetch schema information for a database session.
 * Returns table and column metadata for the schema browser.
 */
export async function getSchema(userId: string, sessionId: string): Promise<SchemaInfo> {
  const session = await prisma.activeSession.findUnique({
    where: { id: sessionId },
  });
  if (!session || session.userId !== userId) {
    throw new AppError('Session not found', 404);
  }
  if (session.status === 'CLOSED') {
    throw new AppError('Session already closed', 410);
  }

  // Schema information is fetched client-side via direct proxy connection.
  // This endpoint validates session access.
  return { tables: [] };
}
