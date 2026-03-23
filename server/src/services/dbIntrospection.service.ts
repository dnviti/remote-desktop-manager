import pg from 'pg';
import mysql from 'mysql2/promise';
import mssql from 'mssql';
import oracledb from 'oracledb';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../utils/logger';

const log = logger.child('db-introspection');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DriverPool =
  | { type: 'postgresql'; pool: pg.Pool }
  | { type: 'mysql'; pool: mysql.Pool }
  | { type: 'mongodb'; client: unknown; dbName: string }
  | { type: 'mssql'; pool: mssql.ConnectionPool }
  | { type: 'oracle'; pool: oracledb.Pool }
  | { type: 'db2'; conn: unknown; dbName: string };

interface ManagedPool {
  sessionId: string;
  protocol: string;
  driver: DriverPool;
  createdAt: Date;
  lastUsedAt: Date;
}

export interface IntrospectionResult {
  supported: boolean;
  data?: unknown;
}

export type IntrospectionType =
  | 'indexes'
  | 'statistics'
  | 'foreign_keys'
  | 'table_schema'
  | 'row_count'
  | 'database_version';

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
        return await getColumnStatistics(driver, target);
      case 'foreign_keys':
        return await getForeignKeys(driver, target);
      case 'table_schema':
        return await getTableSchema(driver, target);
      case 'row_count':
        return await getTableRowCount(driver, target);
      case 'database_version':
        return await getDatabaseVersion(driver);
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
// Indexes
// ---------------------------------------------------------------------------

async function getIndexes(driver: DriverPool, table: string): Promise<IntrospectionResult> {
  switch (driver.type) {
    case 'postgresql': {
      const result = await driver.pool.query(
        `SELECT indexname AS index_name,
                indexdef AS definition,
                array_to_string(ARRAY(
                  SELECT a.attname
                  FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
                  WHERE c.relname = idx.indexname
                ), ', ') AS columns,
                idx.indexname LIKE '%_pkey' AS is_primary,
                (SELECT i.indisunique FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = idx.indexname LIMIT 1) AS is_unique
         FROM pg_indexes idx
         WHERE tablename = $1
         ORDER BY indexname`,
        [table],
      );
      return { supported: true, data: result.rows };
    }
    case 'mysql': {
      // codeql[js/sql-injection] — table name is from introspection metadata, not user SQL input.
      // It is used within SHOW INDEX which does not support parameterized table names.
      const safeName = table.replace(/[^a-zA-Z0-9_]/g, '');
      const [rows] = await driver.pool.query(`SHOW INDEX FROM \`${safeName}\``);
      return { supported: true, data: rows };
    }
    case 'mssql': {
      const result = await driver.pool.request()
        .input('table', mssql.VarChar, table)
        .query(`
          SELECT i.name AS index_name,
                 i.type_desc AS index_type,
                 i.is_unique,
                 i.is_primary_key,
                 STRING_AGG(c.name, ', ') AS columns
          FROM sys.indexes i
          JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
          JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
          WHERE i.object_id = OBJECT_ID(@table) AND i.name IS NOT NULL
          GROUP BY i.name, i.type_desc, i.is_unique, i.is_primary_key
          ORDER BY i.name
        `);
      return { supported: true, data: result.recordset };
    }
    case 'oracle': {
      const conn = await driver.pool.getConnection();
      try {
        const result = await conn.execute<Record<string, unknown>>(
          `SELECT i.INDEX_NAME, i.INDEX_TYPE, i.UNIQUENESS,
                  LISTAGG(ic.COLUMN_NAME, ', ') WITHIN GROUP (ORDER BY ic.COLUMN_POSITION) AS COLUMNS
           FROM USER_INDEXES i
           JOIN USER_IND_COLUMNS ic ON i.INDEX_NAME = ic.INDEX_NAME
           WHERE i.TABLE_NAME = :table
           GROUP BY i.INDEX_NAME, i.INDEX_TYPE, i.UNIQUENESS
           ORDER BY i.INDEX_NAME`,
          { table: table.toUpperCase() },
          { outFormat: oracledb.OUT_FORMAT_OBJECT },
        );
        return { supported: true, data: result.rows };
      } finally {
        await conn.close();
      }
    }
    case 'mongodb':
    case 'db2':
      return { supported: false };
    default:
      return { supported: false };
  }
}

// ---------------------------------------------------------------------------
// Column statistics
// ---------------------------------------------------------------------------

async function getColumnStatistics(driver: DriverPool, target: string): Promise<IntrospectionResult> {
  // target format: "table.column" or just "table"
  const [table, column] = target.includes('.') ? target.split('.', 2) : [target, undefined];

  switch (driver.type) {
    case 'postgresql': {
      const query = column
        ? `SELECT schemaname, tablename, attname, n_distinct, null_frac, avg_width,
                  most_common_vals::text, most_common_freqs::text
           FROM pg_stats
           WHERE tablename = $1 AND attname = $2`
        : `SELECT schemaname, tablename, attname, n_distinct, null_frac, avg_width
           FROM pg_stats
           WHERE tablename = $1`;
      const params = column ? [table, column] : [table];
      const result = await driver.pool.query(query, params);
      return { supported: true, data: result.rows };
    }
    case 'mysql': {
      const safeName = table.replace(/[^a-zA-Z0-9_]/g, '');
      const [rows] = column
        ? await driver.pool.query(
            `SELECT TABLE_NAME, COLUMN_NAME, CARDINALITY, NULLABLE, INDEX_TYPE
             FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
            [safeName, column],
          )
        : await driver.pool.query(
            `SELECT TABLE_NAME, COLUMN_NAME, CARDINALITY, NULLABLE, INDEX_TYPE
             FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
            [safeName],
          );
      return { supported: true, data: rows };
    }
    case 'mssql': {
      const result = await driver.pool.request()
        .input('table', mssql.VarChar, table)
        .query(`
          SELECT s.name AS stat_name, c.name AS column_name,
                 sp.rows, sp.modification_counter, sp.last_updated
          FROM sys.stats s
          JOIN sys.stats_columns sc ON s.object_id = sc.object_id AND s.stats_id = sc.stats_id
          JOIN sys.columns c ON sc.object_id = c.object_id AND sc.column_id = c.column_id
          CROSS APPLY sys.dm_db_stats_properties(s.object_id, s.stats_id) sp
          WHERE s.object_id = OBJECT_ID(@table)
          ORDER BY s.name
        `);
      return { supported: true, data: result.recordset };
    }
    case 'oracle': {
      const conn = await driver.pool.getConnection();
      try {
        const query = column
          ? `SELECT TABLE_NAME, COLUMN_NAME, NUM_DISTINCT, NUM_NULLS, DENSITY, LOW_VALUE, HIGH_VALUE
             FROM USER_TAB_COL_STATISTICS
             WHERE TABLE_NAME = :table AND COLUMN_NAME = :col`
          : `SELECT TABLE_NAME, COLUMN_NAME, NUM_DISTINCT, NUM_NULLS, DENSITY
             FROM USER_TAB_COL_STATISTICS
             WHERE TABLE_NAME = :table`;
        const binds = column
          ? { table: table.toUpperCase(), col: column.toUpperCase() }
          : { table: table.toUpperCase() };
        const result = await conn.execute<Record<string, unknown>>(
          query, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT },
        );
        return { supported: true, data: result.rows };
      } finally {
        await conn.close();
      }
    }
    case 'mongodb':
    case 'db2':
      return { supported: false };
    default:
      return { supported: false };
  }
}

// ---------------------------------------------------------------------------
// Foreign keys
// ---------------------------------------------------------------------------

async function getForeignKeys(driver: DriverPool, table: string): Promise<IntrospectionResult> {
  switch (driver.type) {
    case 'postgresql': {
      const result = await driver.pool.query(
        `SELECT
           tc.constraint_name,
           kcu.column_name,
           ccu.table_name AS referenced_table,
           ccu.column_name AS referenced_column
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
         WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = $1
         ORDER BY tc.constraint_name`,
        [table],
      );
      return { supported: true, data: result.rows };
    }
    case 'mysql': {
      const [rows] = await driver.pool.query(
        `SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
         FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL
         ORDER BY CONSTRAINT_NAME`,
        [table],
      );
      return { supported: true, data: rows };
    }
    case 'mssql': {
      const result = await driver.pool.request()
        .input('table', mssql.VarChar, table)
        .query(`
          SELECT fk.name AS constraint_name,
                 COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS column_name,
                 OBJECT_NAME(fkc.referenced_object_id) AS referenced_table,
                 COL_NAME(fkc.referenced_object_id, fkc.referenced_column_id) AS referenced_column
          FROM sys.foreign_keys fk
          JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
          WHERE fk.parent_object_id = OBJECT_ID(@table)
          ORDER BY fk.name
        `);
      return { supported: true, data: result.recordset };
    }
    case 'oracle': {
      const conn = await driver.pool.getConnection();
      try {
        const result = await conn.execute<Record<string, unknown>>(
          `SELECT a.CONSTRAINT_NAME, a.COLUMN_NAME,
                  c_pk.TABLE_NAME AS REFERENCED_TABLE, b.COLUMN_NAME AS REFERENCED_COLUMN
           FROM USER_CONS_COLUMNS a
           JOIN USER_CONSTRAINTS c ON a.CONSTRAINT_NAME = c.CONSTRAINT_NAME
           JOIN USER_CONSTRAINTS c_pk ON c.R_CONSTRAINT_NAME = c_pk.CONSTRAINT_NAME
           JOIN USER_CONS_COLUMNS b ON c_pk.CONSTRAINT_NAME = b.CONSTRAINT_NAME AND a.POSITION = b.POSITION
           WHERE c.CONSTRAINT_TYPE = 'R' AND a.TABLE_NAME = :table
           ORDER BY a.CONSTRAINT_NAME`,
          { table: table.toUpperCase() },
          { outFormat: oracledb.OUT_FORMAT_OBJECT },
        );
        return { supported: true, data: result.rows };
      } finally {
        await conn.close();
      }
    }
    case 'mongodb':
    case 'db2':
      return { supported: false };
    default:
      return { supported: false };
  }
}

// ---------------------------------------------------------------------------
// Table schema (detailed column info)
// ---------------------------------------------------------------------------

async function getTableSchema(driver: DriverPool, table: string): Promise<IntrospectionResult> {
  switch (driver.type) {
    case 'postgresql': {
      const result = await driver.pool.query(
        `SELECT column_name, data_type, character_maximum_length, column_default,
                is_nullable, udt_name
         FROM information_schema.columns
         WHERE table_name = $1
         ORDER BY ordinal_position`,
        [table],
      );
      return { supported: true, data: result.rows };
    }
    case 'mysql': {
      const [rows] = await driver.pool.query(
        `SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, COLUMN_DEFAULT,
                IS_NULLABLE, COLUMN_TYPE, COLUMN_KEY, EXTRA
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        [table],
      );
      return { supported: true, data: rows };
    }
    case 'mssql': {
      const result = await driver.pool.request()
        .input('table', mssql.VarChar, table)
        .query(`
          SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH,
                 COLUMN_DEFAULT, IS_NULLABLE
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_NAME = @table
          ORDER BY ORDINAL_POSITION
        `);
      return { supported: true, data: result.recordset };
    }
    case 'oracle': {
      const conn = await driver.pool.getConnection();
      try {
        const result = await conn.execute<Record<string, unknown>>(
          `SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH, DATA_DEFAULT, NULLABLE
           FROM USER_TAB_COLUMNS
           WHERE TABLE_NAME = :table
           ORDER BY COLUMN_ID`,
          { table: table.toUpperCase() },
          { outFormat: oracledb.OUT_FORMAT_OBJECT },
        );
        return { supported: true, data: result.rows };
      } finally {
        await conn.close();
      }
    }
    case 'mongodb':
    case 'db2':
      return { supported: false };
    default:
      return { supported: false };
  }
}

// ---------------------------------------------------------------------------
// Table row count (approximate)
// ---------------------------------------------------------------------------

async function getTableRowCount(driver: DriverPool, table: string): Promise<IntrospectionResult> {
  switch (driver.type) {
    case 'postgresql': {
      const result = await driver.pool.query(
        `SELECT reltuples::bigint AS approximate_count
         FROM pg_class WHERE relname = $1`,
        [table],
      );
      return { supported: true, data: result.rows[0] ?? { approximate_count: 0 } };
    }
    case 'mysql': {
      const [rows] = await driver.pool.query(
        `SELECT TABLE_ROWS AS approximate_count
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [table],
      );
      const arr = rows as Record<string, unknown>[];
      return { supported: true, data: arr[0] ?? { approximate_count: 0 } };
    }
    case 'mssql': {
      const result = await driver.pool.request()
        .input('table', mssql.VarChar, table)
        .query(`
          SELECT SUM(p.rows) AS approximate_count
          FROM sys.partitions p
          JOIN sys.tables t ON p.object_id = t.object_id
          WHERE t.name = @table AND p.index_id IN (0, 1)
        `);
      return { supported: true, data: result.recordset[0] ?? { approximate_count: 0 } };
    }
    case 'oracle': {
      const conn = await driver.pool.getConnection();
      try {
        const result = await conn.execute<Record<string, unknown>>(
          `SELECT NUM_ROWS AS APPROXIMATE_COUNT FROM USER_TABLES WHERE TABLE_NAME = :table`,
          { table: table.toUpperCase() },
          { outFormat: oracledb.OUT_FORMAT_OBJECT },
        );
        return { supported: true, data: (result.rows ?? [])[0] ?? { APPROXIMATE_COUNT: 0 } };
      } finally {
        await conn.close();
      }
    }
    case 'mongodb':
    case 'db2':
      return { supported: false };
    default:
      return { supported: false };
  }
}

// ---------------------------------------------------------------------------
// Database version
// ---------------------------------------------------------------------------

async function getDatabaseVersion(driver: DriverPool): Promise<IntrospectionResult> {
  switch (driver.type) {
    case 'postgresql': {
      const result = await driver.pool.query('SELECT version() AS version');
      return { supported: true, data: result.rows[0] };
    }
    case 'mysql': {
      const [rows] = await driver.pool.query('SELECT VERSION() AS version');
      return { supported: true, data: (rows as Record<string, unknown>[])[0] };
    }
    case 'mssql': {
      const result = await driver.pool.request().query('SELECT @@VERSION AS version');
      return { supported: true, data: result.recordset[0] };
    }
    case 'oracle': {
      const conn = await driver.pool.getConnection();
      try {
        const result = await conn.execute<Record<string, unknown>>(
          `SELECT BANNER AS VERSION FROM V$VERSION WHERE ROWNUM = 1`,
          [],
          { outFormat: oracledb.OUT_FORMAT_OBJECT },
        );
        return { supported: true, data: (result.rows ?? [])[0] };
      } finally {
        await conn.close();
      }
    }
    case 'mongodb':
    case 'db2':
      return { supported: false };
    default:
      return { supported: false };
  }
}
