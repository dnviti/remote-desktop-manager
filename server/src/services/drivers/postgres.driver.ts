import pg from 'pg';
import { config } from '../../config';
import type { DbSettings, DbSessionConfig } from '../../types';
import type { QueryResult, SchemaInfo, TableInfo, ViewInfo, RoutineInfo, TriggerInfo, SequenceInfo, DbTypeInfo } from '../dbSession.service';
import type { DriverPool, ExplainResult, IntrospectionResult } from './types';

export async function createPool(
  host: string, port: number, username: string, password: string,
  databaseName: string | undefined, _dbSettings: DbSettings | undefined,
  sessionConfig?: DbSessionConfig,
): Promise<DriverPool> {
  // If sessionConfig.activeDatabase is set, override the pool-level database
  const effectiveDb = sessionConfig?.activeDatabase || databaseName;
  const pool = new pg.Pool({
    host, port, user: username, password, database: effectiveDb,
    max: config.dbPoolMaxConnections,
    idleTimeoutMillis: config.dbPoolIdleTimeoutMs,
    statement_timeout: config.dbQueryTimeoutMs,
  });

  // Apply session config to every new connection via pool event
  if (sessionConfig) {
    const initSql = buildSessionInitSql(sessionConfig);
    if (initSql.length > 0) {
      pool.on('connect', (client: pg.PoolClient) => {
        for (const stmt of initSql) {
          // Fire-and-forget — errors here will surface on the next user query
          client.query(stmt).catch(() => {});
        }
      });
    }
  }

  const client = await pool.connect();
  client.release();
  return { type: 'postgresql', pool };
}

function buildSessionInitSql(sc: DbSessionConfig): string[] {
  const stmts: string[] = [];
  if (sc.timezone) stmts.push(`SET timezone TO '${sc.timezone.replace(/'/g, "''")}'`);
  if (sc.searchPath) stmts.push(`SET search_path TO ${sc.searchPath}`);
  if (sc.encoding) stmts.push(`SET client_encoding TO '${sc.encoding.replace(/'/g, "''")}'`);
  if (sc.initCommands) {
    for (const cmd of sc.initCommands) stmts.push(cmd);
  }
  return stmts;
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

  // --- Views (regular + materialized) ---
  const views: ViewInfo[] = [];
  try {
    const viewsResult = await pool.query(`
      SELECT schemaname AS schema, viewname AS name, false AS materialized
      FROM pg_catalog.pg_views
      WHERE schemaname NOT IN ('pg_catalog','information_schema')
      UNION ALL
      SELECT schemaname AS schema, matviewname AS name, true AS materialized
      FROM pg_catalog.pg_matviews
      WHERE schemaname NOT IN ('pg_catalog','information_schema')
      ORDER BY schema, name
    `);
    for (const r of viewsResult.rows as { schema: string; name: string; materialized: boolean }[]) {
      views.push({ name: r.name, schema: r.schema, materialized: r.materialized });
    }
  } catch { /* best-effort */ }

  // --- Functions (prokind='f') ---
  const functions: RoutineInfo[] = [];
  try {
    const fnResult = await pool.query(`
      SELECT n.nspname AS schema, p.proname AS name,
             pg_get_function_result(p.oid) AS return_type
      FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE p.prokind = 'f'
        AND n.nspname NOT IN ('pg_catalog','information_schema')
      ORDER BY n.nspname, p.proname
    `);
    for (const r of fnResult.rows as { schema: string; name: string; return_type: string }[]) {
      functions.push({ name: r.name, schema: r.schema, returnType: r.return_type });
    }
  } catch { /* best-effort */ }

  // --- Procedures (prokind='p') ---
  const procedures: RoutineInfo[] = [];
  try {
    const procResult = await pool.query(`
      SELECT n.nspname AS schema, p.proname AS name
      FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE p.prokind = 'p'
        AND n.nspname NOT IN ('pg_catalog','information_schema')
      ORDER BY n.nspname, p.proname
    `);
    for (const r of procResult.rows as { schema: string; name: string }[]) {
      procedures.push({ name: r.name, schema: r.schema });
    }
  } catch { /* best-effort */ }

  // --- Triggers ---
  const triggers: TriggerInfo[] = [];
  try {
    const trigResult = await pool.query(`
      SELECT trigger_schema AS schema, trigger_name AS name,
             event_object_table AS table_name,
             action_timing AS timing,
             string_agg(DISTINCT event_manipulation, ',') AS event
      FROM information_schema.triggers
      WHERE trigger_schema NOT IN ('pg_catalog','information_schema')
      GROUP BY trigger_schema, trigger_name, event_object_table, action_timing
      ORDER BY trigger_schema, trigger_name
    `);
    for (const r of trigResult.rows as { schema: string; name: string; table_name: string; timing: string; event: string }[]) {
      triggers.push({ name: r.name, schema: r.schema, tableName: r.table_name, timing: r.timing, event: r.event });
    }
  } catch { /* best-effort */ }

  // --- Sequences ---
  const sequences: SequenceInfo[] = [];
  try {
    const seqResult = await pool.query(`
      SELECT schemaname AS schema, sequencename AS name
      FROM pg_catalog.pg_sequences
      WHERE schemaname NOT IN ('pg_catalog','information_schema')
      ORDER BY schemaname, sequencename
    `);
    for (const r of seqResult.rows as { schema: string; name: string }[]) {
      sequences.push({ name: r.name, schema: r.schema });
    }
  } catch { /* best-effort */ }

  // --- Types (enums, composites, domains, ranges) ---
  const types: DbTypeInfo[] = [];
  try {
    const typResult = await pool.query(`
      SELECT n.nspname AS schema, t.typname AS name,
        CASE t.typtype WHEN 'e' THEN 'enum' WHEN 'c' THEN 'composite'
          WHEN 'd' THEN 'domain' WHEN 'r' THEN 'range' ELSE 'other' END AS kind
      FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid
      WHERE t.typtype IN ('e','c','d','r')
        AND n.nspname NOT IN ('pg_catalog','information_schema')
        AND t.typname NOT LIKE '\\_%'
      ORDER BY n.nspname, t.typname
    `);
    for (const r of typResult.rows as { schema: string; name: string; kind: string }[]) {
      types.push({ name: r.name, schema: r.schema, kind: r.kind });
    }
  } catch { /* best-effort */ }

  return { tables, views, functions, procedures, triggers, sequences, types };
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
  return { supported: true, data: result.rows[0] ?? { version: 'Unknown' } };
}
