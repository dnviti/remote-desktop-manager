import { AppError } from '../../middleware/error.middleware';
import { config } from '../../config';
import type { DbSettings } from '../../types';
import type { QueryResult, SchemaInfo } from '../dbSession.service';
import type { DriverPool } from './types';

export async function createPool(
  host: string, port: number, username: string, password: string,
  databaseName: string | undefined, dbSettings: DbSettings | undefined,
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
  const dbName = databaseName || dbSettings?.db2DatabaseAlias || 'SAMPLE';
  const connStr = `DATABASE=${dbName};HOSTNAME=${host};PORT=${port};PROTOCOL=TCPIP;UID=${username};PWD=${password};QueryTimeout=${Math.floor(config.dbQueryTimeoutMs / 1000)}`;
  const conn = ibmDb.openSync(connStr);
  return { type: 'db2', conn, dbName };
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
  return { tables };
}

export async function destroyPool(conn: unknown): Promise<void> {
  const db2Conn = conn as { closeSync?: () => void };
  db2Conn.closeSync?.();
}
