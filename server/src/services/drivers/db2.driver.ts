import { AppError } from '../../middleware/error.middleware';
import { config } from '../../config';
import type { DbSettings, DbSessionConfig } from '../../types';
import type { QueryResult, SchemaInfo, ViewInfo, RoutineInfo, TriggerInfo, SequenceInfo } from '../dbSession.service';
import type { DriverPool } from './types';

export async function createPool(
  host: string, port: number, username: string, password: string,
  databaseName: string | undefined, dbSettings: DbSettings | undefined,
  sessionConfig?: DbSessionConfig,
): Promise<DriverPool> {
  let ibmDb: typeof import('ibm_db');
  try {
    ibmDb = await import('ibm_db');
  } catch {
    throw new AppError(
      'DB2 driver (ibm_db) is not installed. Install it with: npm install ibm_db',
      501,
    );
  }
  const dbName = sessionConfig?.activeDatabase || databaseName || dbSettings?.db2DatabaseAlias || 'SAMPLE';
  const connStr = `DATABASE=${dbName};HOSTNAME=${host};PORT=${port};PROTOCOL=TCPIP;UID=${username};PWD=${password};QueryTimeout=${Math.floor(config.dbQueryTimeoutMs / 1000)}`;
  const conn = ibmDb.openSync(connStr);

  // Apply session config once after connection (single-connection model)
  if (sessionConfig) {
    const db2Conn = conn as { querySync: (sql: string) => unknown };
    const stmts = buildDb2SessionSql(sessionConfig);
    for (const stmt of stmts) {
      try { db2Conn.querySync(stmt); } catch { /* best-effort */ }
    }
  }

  return { type: 'db2', conn, dbName };
}

function buildDb2SessionSql(sc: DbSessionConfig): string[] {
  const stmts: string[] = [];
  if (sc.timezone) stmts.push(`SET CURRENT TIMEZONE = '${sc.timezone.replace(/'/g, "''")}'`);
  if (sc.searchPath) stmts.push(`SET SCHEMA = ${sc.searchPath}`);
  if (sc.initCommands) {
    for (const cmd of sc.initCommands) stmts.push(cmd);
  }
  return stmts;
}

export async function runQuery(conn: unknown, sql: string, maxRows: number): Promise<QueryResult> {
  // ibm_db is dynamically imported — conn is an ibm_db.Database instance
  // codeql[js/sql-injection] — sql is validated by role-based query restriction and
  // sqlFirewall.evaluateQuery() in dbSession.service.ts before reaching this function.
  const db2Conn = conn as { querySync: (sql: string) => Record<string, unknown>[] };
  const allRows = db2Conn.querySync(sql);
  const columns = allRows.length > 0 ? Object.keys(allRows[0]) : [];
  const truncated = allRows.length > maxRows;
  const rows = truncated ? allRows.slice(0, maxRows) : allRows;
  return { columns, rows, rowCount: allRows.length, durationMs: 0, truncated };
}

export async function fetchSchema(conn: unknown): Promise<SchemaInfo> {
  const db2Conn = conn as { querySync: (sql: string) => Record<string, unknown>[] };
  const tableRows = db2Conn.querySync(
    `SELECT TABSCHEMA AS table_schema, TABNAME AS table_name
     FROM SYSCAT.TABLES WHERE TYPE = 'T'
       AND TABSCHEMA NOT IN ('SYSIBM','SYSCAT','SYSSTAT','SYSPUBLIC','SYSFUN','SYSTOOLS')
     ORDER BY TABSCHEMA, TABNAME`,
  );
  const tables: SchemaInfo['tables'] = [];
  for (const t of tableRows) {
    const colRows = db2Conn.querySync(
      `SELECT c.COLNAME AS column_name, c.TYPENAME AS data_type, c.NULLS AS nullable,
        CASE WHEN kc.COLNAME IS NOT NULL THEN 1 ELSE 0 END AS is_primary_key
      FROM SYSCAT.COLUMNS c
      LEFT JOIN SYSCAT.KEYCOLUSE kc ON c.TABSCHEMA = kc.TABSCHEMA AND c.TABNAME = kc.TABNAME
        AND c.COLNAME = kc.COLNAME
        AND kc.CONSTNAME IN (
          SELECT CONSTNAME FROM SYSCAT.TABCONST
          WHERE TABSCHEMA = '${String(t.table_schema).replace(/'/g, "''")}' AND TABNAME = '${String(t.table_name).replace(/'/g, "''")}' AND TYPE = 'P'
        )
      WHERE c.TABSCHEMA = '${String(t.table_schema).replace(/'/g, "''")}' AND c.TABNAME = '${String(t.table_name).replace(/'/g, "''")}' ORDER BY c.COLNO`,
    );
    tables.push({
      name: String(t.table_name),
      schema: String(t.table_schema),
      columns: colRows.map((c) => ({
        name: String(c.column_name),
        dataType: String(c.data_type),
        nullable: c.nullable === 'Y',
        isPrimaryKey: Boolean(c.is_primary_key),
      })),
    });
  }
  // -- Views (best-effort) --
  const views: ViewInfo[] = [];
  try {
    const viewRows = db2Conn.querySync(
      `SELECT TABSCHEMA AS schema, TABNAME AS name
       FROM SYSCAT.TABLES
       WHERE TYPE = 'V'
         AND TABSCHEMA NOT LIKE 'SYS%'
         AND TABSCHEMA NOT IN ('NULLID','SQLJ','SYSIBMADM')
       ORDER BY TABSCHEMA, TABNAME`,
    );
    for (const v of viewRows) {
      views.push({ name: String(v.name), schema: String(v.schema) });
    }
  } catch { /* best-effort */ }

  // -- Functions (best-effort) --
  const functions: RoutineInfo[] = [];
  try {
    const funcRows = db2Conn.querySync(
      `SELECT FUNCSCHEMA AS schema, FUNCNAME AS name
       FROM SYSCAT.FUNCTIONS
       WHERE FUNCSCHEMA NOT LIKE 'SYS%'
         AND FUNCSCHEMA NOT IN ('NULLID','SQLJ','SYSIBMADM')
         AND ORIGIN IN ('E','U')
       ORDER BY FUNCSCHEMA, FUNCNAME`,
    );
    for (const f of funcRows) {
      functions.push({ name: String(f.name), schema: String(f.schema) });
    }
  } catch { /* best-effort */ }

  // -- Procedures (best-effort) --
  const procedures: RoutineInfo[] = [];
  try {
    const procRows = db2Conn.querySync(
      `SELECT PROCSCHEMA AS schema, PROCNAME AS name
       FROM SYSCAT.PROCEDURES
       WHERE PROCSCHEMA NOT LIKE 'SYS%'
         AND PROCSCHEMA NOT IN ('NULLID','SQLJ','SYSIBMADM')
       ORDER BY PROCSCHEMA, PROCNAME`,
    );
    for (const p of procRows) {
      procedures.push({ name: String(p.name), schema: String(p.schema) });
    }
  } catch { /* best-effort */ }

  // -- Triggers (best-effort) --
  const triggers: TriggerInfo[] = [];
  try {
    const eventMap: Record<string, string> = { I: 'INSERT', U: 'UPDATE', D: 'DELETE' };
    const timingMap: Record<string, string> = { B: 'BEFORE', A: 'AFTER', I: 'INSTEAD OF' };
    const trigRows = db2Conn.querySync(
      `SELECT TRIGSCHEMA AS schema, TRIGNAME AS name, TABNAME AS table_name,
              TRIGEVENT AS event, TRIGTIME AS timing
       FROM SYSCAT.TRIGGERS
       WHERE TRIGSCHEMA NOT LIKE 'SYS%'
         AND TRIGSCHEMA NOT IN ('NULLID','SQLJ','SYSIBMADM')
       ORDER BY TRIGSCHEMA, TRIGNAME`,
    );
    for (const tr of trigRows) {
      const eventCode = String(tr.event).trim();
      const timingCode = String(tr.timing).trim();
      triggers.push({
        name: String(tr.name),
        schema: String(tr.schema),
        tableName: String(tr.table_name),
        event: eventMap[eventCode] || eventCode,
        timing: timingMap[timingCode] || timingCode,
      });
    }
  } catch { /* best-effort */ }

  // -- Sequences (best-effort) --
  const sequences: SequenceInfo[] = [];
  try {
    const seqRows = db2Conn.querySync(
      `SELECT SEQSCHEMA AS schema, SEQNAME AS name
       FROM SYSCAT.SEQUENCES
       WHERE SEQSCHEMA NOT LIKE 'SYS%'
         AND SEQSCHEMA NOT IN ('NULLID','SQLJ','SYSIBMADM')
         AND SEQTYPE = 'S'
       ORDER BY SEQSCHEMA, SEQNAME`,
    );
    for (const s of seqRows) {
      sequences.push({ name: String(s.name), schema: String(s.schema) });
    }
  } catch { /* best-effort */ }

  return { tables, views, functions, procedures, triggers, sequences };
}

export async function destroyPool(conn: unknown): Promise<void> {
  const db2Conn = conn as { closeSync?: () => void };
  db2Conn.closeSync?.();
}
