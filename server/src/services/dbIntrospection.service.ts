import { AppError } from '../middleware/error.middleware';
import { logger } from '../utils/logger';

import * as postgres from './drivers/postgres.driver';
import * as mysql from './drivers/mysql.driver';
import * as mssqlDriver from './drivers/mssql.driver';
import * as oracle from './drivers/oracle.driver';

// Re-export shared types so existing consumers don't break
export type { IntrospectionResult, IntrospectionType } from './drivers/types';
import type { IntrospectionResult, IntrospectionType } from './drivers/types';
import type { DriverPool, ManagedPool } from './drivers/types';

const log = logger.child('db-introspection');

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export async function introspect(
  managed: ManagedPool,
  type: IntrospectionType,
  target: string,
): Promise<IntrospectionResult> {
  const { driver } = managed;

  try {
    switch (type) {
      case 'indexes':
        return await getIndexes(driver, target);
      case 'statistics':
        return await getStatistics(driver, target);
      case 'foreign_keys':
        return await getForeignKeys(driver, target);
      case 'table_schema':
        return await getTableSchema(driver, target);
      case 'row_count':
        return await getRowCount(driver, target);
      case 'database_version':
        return await getVersion(driver);
      default:
        return { supported: false };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Introspection failed';
    log.warn(`Introspection (${type}) failed for session ${managed.sessionId}: ${message}`);
    throw new AppError(message, 400);
  }
}

// ---------------------------------------------------------------------------
// Per-capability dispatchers
// ---------------------------------------------------------------------------

async function getIndexes(driver: DriverPool, table: string): Promise<IntrospectionResult> {
  switch (driver.type) {
    case 'postgresql': return postgres.getIndexes(driver.pool, table);
    case 'mysql': return mysql.getIndexes(driver.pool, table);
    case 'mssql': return mssqlDriver.getIndexes(driver.pool, table);
    case 'oracle': return oracle.getIndexes(driver.pool, table);
    default: return { supported: false };
  }
}

async function getStatistics(driver: DriverPool, target: string): Promise<IntrospectionResult> {
  switch (driver.type) {
    case 'postgresql': return postgres.getStatistics(driver.pool, target);
    case 'mysql': return mysql.getStatistics(driver.pool, target);
    case 'mssql': return mssqlDriver.getStatistics(driver.pool, target);
    case 'oracle': return oracle.getStatistics(driver.pool, target);
    default: return { supported: false };
  }
}

async function getForeignKeys(driver: DriverPool, table: string): Promise<IntrospectionResult> {
  switch (driver.type) {
    case 'postgresql': return postgres.getForeignKeys(driver.pool, table);
    case 'mysql': return mysql.getForeignKeys(driver.pool, table);
    case 'mssql': return mssqlDriver.getForeignKeys(driver.pool, table);
    case 'oracle': return oracle.getForeignKeys(driver.pool, table);
    default: return { supported: false };
  }
}

async function getTableSchema(driver: DriverPool, table: string): Promise<IntrospectionResult> {
  switch (driver.type) {
    case 'postgresql': return postgres.getTableSchema(driver.pool, table);
    case 'mysql': return mysql.getTableSchema(driver.pool, table);
    case 'mssql': return mssqlDriver.getTableSchema(driver.pool, table);
    case 'oracle': return oracle.getTableSchema(driver.pool, table);
    default: return { supported: false };
  }
}

async function getRowCount(driver: DriverPool, table: string): Promise<IntrospectionResult> {
  switch (driver.type) {
    case 'postgresql': return postgres.getRowCount(driver.pool, table);
    case 'mysql': return mysql.getRowCount(driver.pool, table);
    case 'mssql': return mssqlDriver.getRowCount(driver.pool, table);
    case 'oracle': return oracle.getRowCount(driver.pool, table);
    default: return { supported: false };
  }
}

async function getVersion(driver: DriverPool): Promise<IntrospectionResult> {
  switch (driver.type) {
    case 'postgresql': return postgres.getVersion(driver.pool);
    case 'mysql': return mysql.getVersion(driver.pool);
    case 'mssql': return mssqlDriver.getVersion(driver.pool);
    case 'oracle': return oracle.getVersion(driver.pool);
    default: return { supported: false };
  }
}
