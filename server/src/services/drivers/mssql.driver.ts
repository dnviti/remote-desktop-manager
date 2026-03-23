import mssql from 'mssql';
import { config } from '../../config';
import type { DbSettings } from '../../types';
import type { QueryResult, SchemaInfo, TableInfo } from '../dbSession.service';
import type { DriverPool, ExplainResult, IntrospectionResult } from './types';

export async function createPool(
  host: string, port: number, username: string, password: string,
  databaseName: string | undefined, dbSettings: DbSettings | undefined,
): Promise<DriverPool> {
  const mssqlConfig: mssql.config = {
    server: host, port, user: username, password, database: databaseName,
    pool: { max: config.dbPoolMaxConnections, idleTimeoutMillis: config.dbPoolIdleTimeoutMs },
    options: {
      encrypt: false,
      trustServerCertificate: true,
      requestTimeout: config.dbQueryTimeoutMs,
      instanceName: dbSettings?.mssqlInstanceName,
    },
  };
  const pool = await new mssql.ConnectionPool(mssqlConfig).connect();
  return { type: 'mssql', pool };
}

export async function runQuery(pool: mssql.ConnectionPool, sql: string, maxRows: number): Promise<QueryResult> {
  // codeql[js/sql-injection] — sql is validated by role-based query restriction and
  // sqlFirewall.evaluateQuery() in dbSession.service.ts before reaching this function.
  const result = await pool.request().query(sql);
  const allRows = (result.recordset ?? []) as Record<string, unknown>[];
  const columns = result.recordset?.columns
    ? Object.keys(result.recordset.columns)
    : allRows.length > 0
      ? Object.keys(allRows[0])
      : [];
  const truncated = allRows.length > maxRows;
  const rows = truncated ? allRows.slice(0, maxRows) : allRows;
  return { columns, rows, rowCount: result.rowsAffected?.[0] ?? allRows.length, durationMs: 0, truncated };
}

export async function runExplain(pool: mssql.ConnectionPool, sql: string): Promise<ExplainResult> {
  // Use a transaction to pin a single pooled connection for SHOWPLAN_XML.
  // SHOWPLAN settings are connection-scoped; without pinning, the SET and
  // the query could run on different connections, executing the SQL for real.
  const transaction = new mssql.Transaction(pool);
  await transaction.begin();
  try {
    await new mssql.Request(transaction).query('SET SHOWPLAN_XML ON');
    try {
      // codeql[js/sql-injection] — sql is validated upstream before reaching this function.
      const result = await new mssql.Request(transaction).query(sql);
      const rows = (result.recordset ?? []) as Record<string, unknown>[];
      const raw = rows.length > 0 ? String(Object.values(rows[0])[0] ?? '') : '';
      return { supported: true, plan: raw, format: 'xml', raw };
    } finally {
      try { await new mssql.Request(transaction).query('SET SHOWPLAN_XML OFF'); } catch { /* best-effort cleanup */ }
      try { await transaction.rollback(); } catch { /* best-effort cleanup */ }
    }
  } catch (err) {
    try { await transaction.rollback(); } catch { /* best-effort cleanup */ }
    throw err;
  }
}

export async function fetchSchema(pool: mssql.ConnectionPool): Promise<SchemaInfo> {
  const tablesResult = await pool.request().query(`
    SELECT TABLE_SCHEMA AS table_schema, TABLE_NAME AS table_name
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE'
    ORDER BY TABLE_SCHEMA, TABLE_NAME
  `);
  const tables: TableInfo[] = [];
  for (const t of tablesResult.recordset as { table_schema: string; table_name: string }[]) {
    const colsResult = await pool.request()
      .input('schema', mssql.VarChar, t.table_schema)
      .input('table', mssql.VarChar, t.table_name)
      .query(`
        SELECT
          c.COLUMN_NAME AS column_name,
          c.DATA_TYPE AS data_type,
          CASE WHEN c.IS_NULLABLE = 'YES' THEN 1 ELSE 0 END AS nullable,
          CASE WHEN kcu.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS is_primary_key
        FROM INFORMATION_SCHEMA.COLUMNS c
        LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
          ON c.TABLE_SCHEMA = kcu.TABLE_SCHEMA
          AND c.TABLE_NAME = kcu.TABLE_NAME
          AND c.COLUMN_NAME = kcu.COLUMN_NAME
          AND kcu.CONSTRAINT_NAME IN (
            SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
            WHERE CONSTRAINT_TYPE = 'PRIMARY KEY'
              AND TABLE_SCHEMA = @schema AND TABLE_NAME = @table
          )
        WHERE c.TABLE_SCHEMA = @schema AND c.TABLE_NAME = @table
        ORDER BY c.ORDINAL_POSITION
      `);
    tables.push({
      name: t.table_name,
      schema: t.table_schema,
      columns: (colsResult.recordset as { column_name: string; data_type: string; nullable: number; is_primary_key: number }[]).map((c) => ({
        name: c.column_name,
        dataType: c.data_type,
        nullable: Boolean(c.nullable),
        isPrimaryKey: Boolean(c.is_primary_key),
      })),
    });
  }
  return { tables };
}

export async function destroyPool(pool: mssql.ConnectionPool): Promise<void> {
  await pool.close();
}

// --- Introspection ---

export async function getIndexes(pool: mssql.ConnectionPool, table: string): Promise<IntrospectionResult> {
  const result = await pool.request()
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

export async function getStatistics(pool: mssql.ConnectionPool, target: string): Promise<IntrospectionResult> {
  const [table] = target.includes('.') ? target.split('.', 2) : [target];
  const result = await pool.request()
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

export async function getForeignKeys(pool: mssql.ConnectionPool, table: string): Promise<IntrospectionResult> {
  const result = await pool.request()
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

export async function getTableSchema(pool: mssql.ConnectionPool, table: string): Promise<IntrospectionResult> {
  const result = await pool.request()
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

export async function getRowCount(pool: mssql.ConnectionPool, table: string): Promise<IntrospectionResult> {
  const result = await pool.request()
    .input('table', mssql.VarChar, table)
    .query(`
      SELECT SUM(p.rows) AS approximate_count
      FROM sys.partitions p
      JOIN sys.tables t ON p.object_id = t.object_id
      WHERE t.name = @table AND p.index_id IN (0, 1)
    `);
  return { supported: true, data: result.recordset[0] ?? { approximate_count: 0 } };
}

export async function getVersion(pool: mssql.ConnectionPool): Promise<IntrospectionResult> {
  const result = await pool.request().query('SELECT @@VERSION AS version');
  return { supported: true, data: result.recordset[0] };
}
