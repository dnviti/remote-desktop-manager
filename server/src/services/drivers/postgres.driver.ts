import pg from 'pg';
import { config } from '../../config';
import type { DbSettings } from '../../types';
import type { QueryResult, SchemaInfo, TableInfo } from '../dbSession.service';
import type { DriverPool, ExplainResult, IntrospectionResult } from './types';

export async function createPool(
  host: string, port: number, username: string, password: string,
  databaseName: string | undefined, _dbSettings: DbSettings | undefined,
): Promise<DriverPool> {
  const pool = new pg.Pool({
    host, port, user: username, password, database: databaseName,
    max: config.dbPoolMaxConnections,
    idleTimeoutMillis: config.dbPoolIdleTimeoutMs,
    statement_timeout: config.dbQueryTimeoutMs,
  });
  const client = await pool.connect();
  client.release();
  return { type: 'postgresql', pool };
}

export async function runQuery(pool: pg.Pool, sql: string, maxRows: number): Promise<QueryResult> {
  // codeql[js/sql-injection] — sql is validated by role-based query restriction and
  // sqlFirewall.evaluateQuery() in dbSession.service.ts before reaching this function.
  const result = await pool.query(sql);
  const columns = result.fields?.map((f) => f.name) ?? [];
  const allRows = (result.rows ?? []) as Record<string, unknown>[];
  const truncated = allRows.length > maxRows;
  const rows = truncated ? allRows.slice(0, maxRows) : allRows;
  return { columns, rows, rowCount: result.rowCount ?? allRows.length, durationMs: 0, truncated };
}

export async function runExplain(pool: pg.Pool, sql: string): Promise<ExplainResult> {
  // codeql[js/sql-injection] — sql is validated by role-based query restriction and
  // sqlFirewall.evaluateQuery() in dbSession.service.ts before reaching this function.
  const result = await pool.query(`EXPLAIN (ANALYZE false, FORMAT JSON) ${sql}`);
  const planRows = (result.rows ?? []) as Record<string, unknown>[];
  const plan = planRows[0]?.['QUERY PLAN'] ?? planRows;
  return { supported: true, plan, format: 'json', raw: JSON.stringify(plan, null, 2) };
}

export async function fetchSchema(pool: pg.Pool): Promise<SchemaInfo> {
  const tablesResult = await pool.query(`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      AND table_type = 'BASE TABLE'
    ORDER BY table_schema, table_name
  `);

  const tables: TableInfo[] = [];
  for (const t of tablesResult.rows as { table_schema: string; table_name: string }[]) {
    const colsResult = await pool.query(
      `SELECT
        c.column_name,
        c.data_type,
        c.is_nullable = 'YES' AS nullable,
        COALESCE(bool_or(tc.constraint_type = 'PRIMARY KEY'), false) AS is_primary_key
      FROM information_schema.columns c
      LEFT JOIN information_schema.key_column_usage kcu
        ON c.table_schema = kcu.table_schema
        AND c.table_name = kcu.table_name
        AND c.column_name = kcu.column_name
      LEFT JOIN information_schema.table_constraints tc
        ON kcu.constraint_name = tc.constraint_name
        AND kcu.table_schema = tc.table_schema
        AND tc.constraint_type = 'PRIMARY KEY'
      WHERE c.table_schema = $1 AND c.table_name = $2
      GROUP BY c.column_name, c.data_type, c.is_nullable, c.ordinal_position
      ORDER BY c.ordinal_position`,
      [t.table_schema, t.table_name],
    );
    tables.push({
      name: t.table_name,
      schema: t.table_schema,
      columns: (colsResult.rows as { column_name: string; data_type: string; nullable: boolean; is_primary_key: boolean }[]).map((c) => ({
        name: c.column_name,
        dataType: c.data_type,
        nullable: c.nullable,
        isPrimaryKey: c.is_primary_key,
      })),
    });
  }
  return { tables };
}

export async function destroyPool(pool: pg.Pool): Promise<void> {
  await pool.end();
}

// --- Introspection ---

export async function getIndexes(pool: pg.Pool, table: string): Promise<IntrospectionResult> {
  const result = await pool.query(
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

export async function getStatistics(pool: pg.Pool, target: string): Promise<IntrospectionResult> {
  const [table, column] = target.includes('.') ? target.split('.', 2) : [target, undefined];
  const query = column
    ? `SELECT schemaname, tablename, attname, n_distinct, null_frac, avg_width,
              most_common_vals::text, most_common_freqs::text
       FROM pg_stats
       WHERE tablename = $1 AND attname = $2`
    : `SELECT schemaname, tablename, attname, n_distinct, null_frac, avg_width
       FROM pg_stats
       WHERE tablename = $1`;
  const params = column ? [table, column] : [table];
  const result = await pool.query(query, params);
  return { supported: true, data: result.rows };
}

export async function getForeignKeys(pool: pg.Pool, table: string): Promise<IntrospectionResult> {
  const result = await pool.query(
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

export async function getTableSchema(pool: pg.Pool, table: string): Promise<IntrospectionResult> {
  const result = await pool.query(
    `SELECT column_name, data_type, character_maximum_length, column_default,
            is_nullable, udt_name
     FROM information_schema.columns
     WHERE table_name = $1
     ORDER BY ordinal_position`,
    [table],
  );
  return { supported: true, data: result.rows };
}

export async function getRowCount(pool: pg.Pool, table: string): Promise<IntrospectionResult> {
  const result = await pool.query(
    `SELECT reltuples::bigint AS approximate_count
     FROM pg_class WHERE relname = $1`,
    [table],
  );
  return { supported: true, data: result.rows[0] ?? { approximate_count: 0 } };
}

export async function getVersion(pool: pg.Pool): Promise<IntrospectionResult> {
  const result = await pool.query('SELECT version() AS version');
  return { supported: true, data: result.rows[0] };
}
