import { AppError } from '../middleware/error.middleware';
import { getConnectionCredentials } from './connection.service';
import { logger } from '../utils/logger';
import type { DbProtocol, DbSettings, OracleConnectionType, OracleRole } from '../types';
import type { QueryResult, SchemaInfo } from './dbSession.service';

import * as postgres from './drivers/postgres.driver';
import * as mysql from './drivers/mysql.driver';
import * as mongodb from './drivers/mongodb.driver';
import * as mssqlDriver from './drivers/mssql.driver';
import * as oracle from './drivers/oracle.driver';
import * as db2 from './drivers/db2.driver';

// Re-export shared types so existing consumers don't break
export type { DriverPool, ManagedPool, ExplainResult } from './drivers/types';
import type { DriverPool, ManagedPool, ExplainResult } from './drivers/types';

const log = logger.child('db-query-executor');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PoolParams {
  sessionId: string;
  connectionId: string;
  userId: string;
  tenantId: string;
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// In-memory pool registry
// ---------------------------------------------------------------------------

const pools = new Map<string, ManagedPool>();

// ---------------------------------------------------------------------------
// Pool creation (dispatches to per-protocol driver)
// ---------------------------------------------------------------------------

async function createDriverPool(
  protocol: DbProtocol,
  host: string,
  port: number,
  username: string,
  password: string,
  databaseName: string | undefined,
  dbSettings: DbSettings | undefined,
): Promise<DriverPool> {
  switch (protocol) {
    case 'postgresql':
      return postgres.createPool(host, port, username, password, databaseName, dbSettings);
    case 'mysql':
      return mysql.createPool(host, port, username, password, databaseName, dbSettings);
    case 'mongodb':
      return mongodb.createPool(host, port, username, password, databaseName, dbSettings);
    case 'mssql':
      return mssqlDriver.createPool(host, port, username, password, databaseName, dbSettings);
    case 'oracle':
      return oracle.createPool(host, port, username, password, databaseName, dbSettings);
    case 'db2':
      return db2.createPool(host, port, username, password, databaseName, dbSettings);
    default:
      throw new AppError(`Unsupported database protocol: ${protocol as string}`, 400);
  }
}

// ---------------------------------------------------------------------------
// Get or create pool
// ---------------------------------------------------------------------------

export async function getOrCreatePool(params: PoolParams): Promise<ManagedPool> {
  const existing = pools.get(params.sessionId);
  if (existing) {
    existing.lastUsedAt = new Date();
    return existing;
  }

  const meta = params.metadata;
  const protocol = (meta.dbProtocol as DbProtocol) || 'postgresql';
  const host = (meta.resolvedHost as string) || (meta.host as string);
  const port = (meta.resolvedPort as number) || (meta.port as number);
  const databaseName = meta.databaseName as string | undefined;
  const dbSettings: DbSettings | undefined = meta.dbProtocol
    ? { protocol, databaseName, ...pickDbSettingsFields(meta) }
    : undefined;

  // Resolve credentials from vault
  const creds = await getConnectionCredentials(params.userId, params.connectionId, params.tenantId);

  const driver = await createDriverPool(
    protocol,
    host,
    port,
    creds.username,
    creds.password,
    databaseName,
    dbSettings,
  );

  const managed: ManagedPool = {
    sessionId: params.sessionId,
    protocol,
    driver,
    databaseName,
    createdAt: new Date(),
    lastUsedAt: new Date(),
  };

  pools.set(params.sessionId, managed);
  log.info(`Connection pool created for session ${params.sessionId} (${protocol})`);
  return managed;
}

function pickDbSettingsFields(meta: Record<string, unknown>): Partial<DbSettings> {
  const fields: Partial<DbSettings> = {};
  // Oracle
  if (meta.oracleConnectionType) fields.oracleConnectionType = meta.oracleConnectionType as OracleConnectionType;
  if (meta.oracleSid) fields.oracleSid = meta.oracleSid as string;
  if (meta.oracleServiceName) fields.oracleServiceName = meta.oracleServiceName as string;
  if (meta.oracleRole) fields.oracleRole = meta.oracleRole as OracleRole;
  if (meta.oracleTnsAlias) fields.oracleTnsAlias = meta.oracleTnsAlias as string;
  if (meta.oracleTnsDescriptor) fields.oracleTnsDescriptor = meta.oracleTnsDescriptor as string;
  if (meta.oracleConnectString) fields.oracleConnectString = meta.oracleConnectString as string;
  // MSSQL
  if (meta.mssqlInstanceName) fields.mssqlInstanceName = meta.mssqlInstanceName as string;
  if (meta.mssqlAuthMode) fields.mssqlAuthMode = meta.mssqlAuthMode as 'sql' | 'windows';
  // DB2
  if (meta.db2DatabaseAlias) fields.db2DatabaseAlias = meta.db2DatabaseAlias as string;
  return fields;
}

// ---------------------------------------------------------------------------
// Query execution
// ---------------------------------------------------------------------------

export async function runQuery(
  managed: ManagedPool,
  sql: string,
  maxRows: number,
  timeoutMs: number,
): Promise<QueryResult> {
  const startTime = Date.now();
  const { driver } = managed;

  try {
    switch (driver.type) {
      case 'postgresql':
        return await postgres.runQuery(driver.pool, sql, maxRows);
      case 'mysql':
        return await mysql.runQuery(driver.pool, sql, maxRows);
      case 'mongodb':
        return await mongodb.runQuery(driver.client, driver.dbName, sql, maxRows);
      case 'mssql':
        return await mssqlDriver.runQuery(driver.pool, sql, maxRows);
      case 'oracle':
        return await oracle.runQuery(driver.pool, sql, maxRows, timeoutMs);
      case 'db2':
        return await db2.runQuery(driver.conn, sql, maxRows);
      default:
        throw new AppError('Unsupported protocol', 400);
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Query execution failed';
    throw new AppError(message, 400);
  } finally {
    const elapsed = Date.now() - startTime;
    log.debug?.(`Query executed in ${elapsed}ms for session ${managed.sessionId}`);
  }
}

// ---------------------------------------------------------------------------
// Execution plan (EXPLAIN)
// ---------------------------------------------------------------------------

export async function runExplain(
  managed: ManagedPool,
  sql: string,
): Promise<ExplainResult> {
  const { driver } = managed;

  try {
    switch (driver.type) {
      case 'postgresql':
        return await postgres.runExplain(driver.pool, sql);
      case 'mysql':
        return await mysql.runExplain(driver.pool, sql);
      case 'mssql':
        return await mssqlDriver.runExplain(driver.pool, sql);
      case 'oracle':
        return await oracle.runExplain(driver.pool, sql);
      case 'mongodb':
      case 'db2':
        return { supported: false };
      default:
        return { supported: false };
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Explain failed';
    throw new AppError(message, 400);
  }
}

// ---------------------------------------------------------------------------
// Schema fetching
// ---------------------------------------------------------------------------

export async function fetchSchema(managed: ManagedPool): Promise<SchemaInfo> {
  const { driver } = managed;

  try {
    switch (driver.type) {
      case 'postgresql':
        return await postgres.fetchSchema(driver.pool);
      case 'mysql':
        return await mysql.fetchSchema(driver.pool);
      case 'mongodb':
        return await mongodb.fetchSchema(driver.client, driver.dbName);
      case 'mssql':
        return await mssqlDriver.fetchSchema(driver.pool);
      case 'oracle':
        return await oracle.fetchSchema(driver.pool, managed.databaseName);
      case 'db2':
        return await db2.fetchSchema(driver.conn);
      default:
        return { tables: [] };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Schema fetch failed';
    log.warn(`Schema fetch failed for session ${managed.sessionId}: ${message}`);
    return { tables: [] };
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export async function destroyPool(sessionId: string): Promise<void> {
  const managed = pools.get(sessionId);
  if (!managed) return;

  pools.delete(sessionId);
  try {
    switch (managed.driver.type) {
      case 'postgresql':
        await postgres.destroyPool(managed.driver.pool);
        break;
      case 'mysql':
        await mysql.destroyPool(managed.driver.pool);
        break;
      case 'mongodb':
        await mongodb.destroyPool(managed.driver.client);
        break;
      case 'mssql':
        await mssqlDriver.destroyPool(managed.driver.pool);
        break;
      case 'oracle':
        await oracle.destroyPool(managed.driver.pool);
        break;
      case 'db2':
        await db2.destroyPool(managed.driver.conn);
        break;
    }
    log.info(`Connection pool destroyed for session ${sessionId}`);
  } catch (err) {
    log.warn(`Failed to close pool for session ${sessionId}: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

export async function destroyAllPools(): Promise<void> {
  const sessionIds = [...pools.keys()];
  for (const id of sessionIds) {
    await destroyPool(id);
  }
  if (sessionIds.length > 0) {
    log.info(`Destroyed ${sessionIds.length} DB connection pool(s) on shutdown`);
  }
}
