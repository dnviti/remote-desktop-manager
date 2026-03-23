import mysql from 'mysql2/promise';
import { config } from '../../config';
import type { DbSettings } from '../../types';
import type { QueryResult, SchemaInfo, TableInfo } from '../dbSession.service';
import type { DriverPool, ExplainResult, IntrospectionResult } from './types';

export async function createPool(
  host: string, port: number, username: string, password: string,
  databaseName: string | undefined, _dbSettings: DbSettings | undefined,
): Promise<DriverPool> {
  const pool = mysql.createPool({
    host, port, user: username, password, database: databaseName,
    connectionLimit: config.dbPoolMaxConnections,
    waitForConnections: true,
    idleTimeout: config.dbPoolIdleTimeoutMs,
  });
  const conn = await pool.getConnection();
  conn.release();
  return { type: 'mysql', pool };
}

export async function runQuery(pool: mysql.Pool, sql: string, maxRows: number): Promise<QueryResult> {
  // codeql[js/sql-injection] — sql is validated by role-based query restriction and
  // sqlFirewall.evaluateQuery() in dbSession.service.ts before reaching this function.
  const [rawRows, fields] = await pool.query(sql);
  const fieldList = Array.isArray(fields) ? fields : [];
  const columns = fieldList.map((f) => f.name);
  const allRows = Array.isArray(rawRows) ? (rawRows as Record<string, unknown>[]) : [];
  const truncated = allRows.length > maxRows;
  const rows = truncated ? allRows.slice(0, maxRows) : allRows;
  return { columns, rows, rowCount: allRows.length, durationMs: 0, truncated };
}

export async function runExplain(pool: mysql.Pool, sql: string): Promise<ExplainResult> {
  // codeql[js/sql-injection] — sql is validated upstream before reaching this function.
  const [rows] = await pool.query(`EXPLAIN FORMAT=JSON ${sql}`);
  const arr = rows as Record<string, unknown>[];
  const raw = (arr[0]?.EXPLAIN as string) ?? JSON.stringify(arr);
  let plan: unknown;
  try { plan = JSON.parse(raw); } catch { plan = arr; }
  return { supported: true, plan, format: 'json', raw };
}

export async function fetchSchema(pool: mysql.Pool): Promise<SchemaInfo> {
  const [tablesRaw] = await pool.query(
    `SELECT TABLE_SCHEMA AS table_schema, TABLE_NAME AS table_name
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`,
  );
  const tableRows = tablesRaw as { table_schema: string; table_name: string }[];
  const tables: TableInfo[] = [];
  for (const t of tableRows) {
    const [colsRaw] = await pool.query(
      `SELECT
        COLUMN_NAME AS column_name,
        DATA_TYPE AS data_type,
        IS_NULLABLE = 'YES' AS nullable,
        COLUMN_KEY = 'PRI' AS is_primary_key
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
      [t.table_schema, t.table_name],
    );
    const colRows = colsRaw as { column_name: string; data_type: string; nullable: number; is_primary_key: number }[];
    tables.push({
      name: t.table_name,
      schema: t.table_schema,
      columns: colRows.map((c) => ({
        name: c.column_name,
        dataType: c.data_type,
        nullable: Boolean(c.nullable),
        isPrimaryKey: Boolean(c.is_primary_key),
      })),
    });
  }
  return { tables };
}

export async function destroyPool(pool: mysql.Pool): Promise<void> {
  await pool.end();
}

// --- Introspection ---

export async function getIndexes(pool: mysql.Pool, table: string): Promise<IntrospectionResult> {
  // codeql[js/sql-injection] — table name is from introspection metadata, not user SQL input.
  // It is used within SHOW INDEX which does not support parameterized table names.
  const safeName = table.replace(/[^a-zA-Z0-9_]/g, '');
  const [rows] = await pool.query(`SHOW INDEX FROM \`${safeName}\``);
  return { supported: true, data: rows };
}

export async function getStatistics(pool: mysql.Pool, target: string): Promise<IntrospectionResult> {
  const [table, column] = target.includes('.') ? target.split('.', 2) : [target, undefined];
  const safeName = table.replace(/[^a-zA-Z0-9_]/g, '');
  const [rows] = column
    ? await pool.query(
        `SELECT TABLE_NAME, COLUMN_NAME, CARDINALITY, NULLABLE, INDEX_TYPE
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [safeName, column],
      )
    : await pool.query(
        `SELECT TABLE_NAME, COLUMN_NAME, CARDINALITY, NULLABLE, INDEX_TYPE
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [safeName],
      );
  return { supported: true, data: rows };
}

export async function getForeignKeys(pool: mysql.Pool, table: string): Promise<IntrospectionResult> {
  const [rows] = await pool.query(
    `SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL
     ORDER BY CONSTRAINT_NAME`,
    [table],
  );
  return { supported: true, data: rows };
}

export async function getTableSchema(pool: mysql.Pool, table: string): Promise<IntrospectionResult> {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, COLUMN_DEFAULT,
            IS_NULLABLE, COLUMN_TYPE, COLUMN_KEY, EXTRA
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [table],
  );
  return { supported: true, data: rows };
}

export async function getRowCount(pool: mysql.Pool, table: string): Promise<IntrospectionResult> {
  const [rows] = await pool.query(
    `SELECT TABLE_ROWS AS approximate_count
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table],
  );
  const arr = rows as Record<string, unknown>[];
  return { supported: true, data: arr[0] ?? { approximate_count: 0 } };
}

export async function getVersion(pool: mysql.Pool): Promise<IntrospectionResult> {
  const [rows] = await pool.query('SELECT VERSION() AS version');
  return { supported: true, data: (rows as Record<string, unknown>[])[0] };
}
