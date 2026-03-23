import type OracleDb from 'oracledb';
import { AppError } from '../../middleware/error.middleware';
import { config } from '../../config';
import type { DbSettings } from '../../types';
import type { QueryResult, SchemaInfo, TableInfo } from '../dbSession.service';
import type { DriverPool, ExplainResult, IntrospectionResult } from './types';

// ---------------------------------------------------------------------------
// Lazy-loaded Oracle driver
// ---------------------------------------------------------------------------

let _oracledb: typeof OracleDb | null = null;

async function getOracleDb(): Promise<typeof OracleDb> {
  if (!_oracledb) {
    try {
      _oracledb = (await import('oracledb')).default;
    } catch {
      throw new AppError(
        'Oracle driver (oracledb) is not available. Ensure Oracle Client libraries are installed or use Thin mode.',
        501,
      );
    }
  }
  return _oracledb;
}

// ---------------------------------------------------------------------------
// Pool creation
// ---------------------------------------------------------------------------

export async function createPool(
  host: string, port: number, username: string, password: string,
  databaseName: string | undefined, dbSettings: DbSettings | undefined,
): Promise<DriverPool> {
  const oracledb = await getOracleDb();
  const connType = dbSettings?.oracleConnectionType ?? 'basic';
  let connectString: string;

  if (connType === 'custom' && dbSettings?.oracleConnectString) {
    connectString = dbSettings.oracleConnectString;
  } else if (connType === 'tns') {
    if (dbSettings?.oracleTnsDescriptor) {
      connectString = dbSettings.oracleTnsDescriptor;
    } else if (dbSettings?.oracleTnsAlias) {
      connectString = dbSettings.oracleTnsAlias;
    } else {
      throw new AppError('TNS mode requires either a TNS alias or a TNS descriptor', 400);
    }
  } else {
    // Basic mode (default, backward compatible)
    if (dbSettings?.oracleServiceName) {
      connectString = `${host}:${port}/${dbSettings.oracleServiceName}`;
    } else if (dbSettings?.oracleSid) {
      connectString = `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${host})(PORT=${port}))(CONNECT_DATA=(SID=${dbSettings.oracleSid})))`;
    } else {
      connectString = `${host}:${port}/${databaseName || 'ORCL'}`;
    }
  }

  const poolConfig: Parameters<typeof oracledb.createPool>[0] = {
    user: username, password, connectString,
    poolMin: 0,
    poolMax: config.dbPoolMaxConnections,
    poolTimeout: Math.floor(config.dbPoolIdleTimeoutMs / 1000),
  };

  const role = dbSettings?.oracleRole;
  if (role && role !== 'normal') {
    const roleMap: Record<string, number> = {
      sysdba: oracledb.SYSDBA, sysoper: oracledb.SYSOPER,
      sysasm: oracledb.SYSASM, sysbackup: oracledb.SYSBACKUP,
      sysdg: oracledb.SYSDG, syskm: oracledb.SYSKM, sysrac: oracledb.SYSRAC,
    };
    if (roleMap[role]) poolConfig.privilege = roleMap[role];
  }

  const pool = await oracledb.createPool(poolConfig);
  return { type: 'oracle', pool };
}

// ---------------------------------------------------------------------------
// Query execution
// ---------------------------------------------------------------------------

export async function runQuery(
  pool: OracleDb.Pool, sql: string, maxRows: number, timeoutMs: number,
): Promise<QueryResult> {
  const oracledb = await getOracleDb();
  const conn = await pool.getConnection();
  try {
    conn.callTimeout = timeoutMs;
    // codeql[js/sql-injection] — sql is validated by role-based query restriction and
    // sqlFirewall.evaluateQuery() in dbSession.service.ts before reaching this function.
    const result = await conn.execute(sql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      maxRows: maxRows + 1,
    });
    const metaData = result.metaData ?? [];
    const columns = metaData.map((m) => m.name);
    const allRows = (result.rows ?? []) as Record<string, unknown>[];
    const truncated = allRows.length > maxRows;
    const rows = truncated ? allRows.slice(0, maxRows) : allRows;
    return { columns, rows, rowCount: result.rowsAffected ?? allRows.length, durationMs: 0, truncated };
  } finally {
    await conn.close();
  }
}

// ---------------------------------------------------------------------------
// Execution plan
// ---------------------------------------------------------------------------

export async function runExplain(pool: OracleDb.Pool, sql: string): Promise<ExplainResult> {
  const oracledb = await getOracleDb();
  const conn = await pool.getConnection();
  const statementId = `EXPL_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    // codeql[js/sql-injection] — sql is validated upstream before reaching this function.
    await conn.execute(
      `EXPLAIN PLAN SET STATEMENT_ID = :id FOR ${sql}`,
      { id: statementId },
    );
    const result = await conn.execute<Record<string, unknown>>(
      `SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY(NULL, :id))`,
      { id: statementId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const rows = result.rows ?? [];
    const raw = rows.map((r) => String((r as Record<string, unknown>).PLAN_TABLE_OUTPUT ?? '')).join('\n');
    return { supported: true, plan: rows, format: 'text', raw };
  } finally {
    try {
      await conn.execute(`DELETE FROM PLAN_TABLE WHERE STATEMENT_ID = :id`, { id: statementId });
    } catch { /* best-effort cleanup */ }
    await conn.close();
  }
}

// ---------------------------------------------------------------------------
// Schema fetching
// ---------------------------------------------------------------------------

export async function fetchSchema(pool: OracleDb.Pool, schemaName?: string): Promise<SchemaInfo> {
  const oracledb = await getOracleDb();
  const conn = await pool.getConnection();
  try {
    const tablesResult = schemaName
      ? await conn.execute<{ OWNER: string; TABLE_NAME: string }>(
          `SELECT OWNER, TABLE_NAME FROM ALL_TABLES
           WHERE OWNER = :sname
           ORDER BY TABLE_NAME`,
          { sname: schemaName.toUpperCase() },
          { outFormat: oracledb.OUT_FORMAT_OBJECT },
        )
      : await conn.execute<{ OWNER: string; TABLE_NAME: string }>(
          `SELECT OWNER, TABLE_NAME FROM ALL_TABLES
           WHERE OWNER NOT IN ('SYS','SYSTEM','DBSNMP','OUTLN','XDB')
           ORDER BY OWNER, TABLE_NAME`,
          [],
          { outFormat: oracledb.OUT_FORMAT_OBJECT },
        );
    const tables: TableInfo[] = [];
    for (const t of tablesResult.rows ?? []) {
      const colsResult = await conn.execute<{
        COLUMN_NAME: string; DATA_TYPE: string; NULLABLE: string; IS_PK: number;
      }>(
        `SELECT c.COLUMN_NAME, c.DATA_TYPE, c.NULLABLE,
          CASE WHEN cc.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS IS_PK
        FROM ALL_TAB_COLUMNS c
        LEFT JOIN ALL_CONS_COLUMNS cc ON c.OWNER = cc.OWNER AND c.TABLE_NAME = cc.TABLE_NAME
          AND c.COLUMN_NAME = cc.COLUMN_NAME
          AND cc.CONSTRAINT_NAME IN (
            SELECT CONSTRAINT_NAME FROM ALL_CONSTRAINTS
            WHERE OWNER = :pk_towner AND TABLE_NAME = :pk_tname AND CONSTRAINT_TYPE = 'P'
          )
        WHERE c.OWNER = :towner AND c.TABLE_NAME = :tname
        ORDER BY c.COLUMN_ID`,
        { towner: t.OWNER, tname: t.TABLE_NAME, pk_towner: t.OWNER, pk_tname: t.TABLE_NAME },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      tables.push({
        name: t.TABLE_NAME,
        schema: t.OWNER,
        columns: (colsResult.rows ?? []).map((c) => ({
          name: c.COLUMN_NAME,
          dataType: c.DATA_TYPE,
          nullable: c.NULLABLE === 'Y',
          isPrimaryKey: Boolean(c.IS_PK),
        })),
      });
    }
    return { tables };
  } finally {
    await conn.close();
  }
}

export async function destroyPool(pool: OracleDb.Pool): Promise<void> {
  await pool.close(0);
}

// ---------------------------------------------------------------------------
// Introspection
// ---------------------------------------------------------------------------

export async function getIndexes(pool: OracleDb.Pool, table: string): Promise<IntrospectionResult> {
  const oracledb = await getOracleDb();
  const conn = await pool.getConnection();
  try {
    const result = await conn.execute<Record<string, unknown>>(
      `SELECT i.INDEX_NAME, i.INDEX_TYPE, i.UNIQUENESS,
              LISTAGG(ic.COLUMN_NAME, ', ') WITHIN GROUP (ORDER BY ic.COLUMN_POSITION) AS COLUMNS
       FROM USER_INDEXES i
       JOIN USER_IND_COLUMNS ic ON i.INDEX_NAME = ic.INDEX_NAME
       WHERE i.TABLE_NAME = :tname
       GROUP BY i.INDEX_NAME, i.INDEX_TYPE, i.UNIQUENESS
       ORDER BY i.INDEX_NAME`,
      { tname: table.toUpperCase() },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return { supported: true, data: result.rows };
  } finally {
    await conn.close();
  }
}

export async function getStatistics(pool: OracleDb.Pool, target: string): Promise<IntrospectionResult> {
  const oracledb = await getOracleDb();
  const [table, column] = target.includes('.') ? target.split('.', 2) : [target, undefined];
  const conn = await pool.getConnection();
  try {
    const query = column
      ? `SELECT TABLE_NAME, COLUMN_NAME, NUM_DISTINCT, NUM_NULLS, DENSITY, LOW_VALUE, HIGH_VALUE
         FROM USER_TAB_COL_STATISTICS
         WHERE TABLE_NAME = :tname AND COLUMN_NAME = :col`
      : `SELECT TABLE_NAME, COLUMN_NAME, NUM_DISTINCT, NUM_NULLS, DENSITY
         FROM USER_TAB_COL_STATISTICS
         WHERE TABLE_NAME = :tname`;
    const binds = column
      ? { tname: table.toUpperCase(), col: column.toUpperCase() }
      : { tname: table.toUpperCase() };
    const result = await conn.execute<Record<string, unknown>>(
      query, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return { supported: true, data: result.rows };
  } finally {
    await conn.close();
  }
}

export async function getForeignKeys(pool: OracleDb.Pool, table: string): Promise<IntrospectionResult> {
  const oracledb = await getOracleDb();
  const conn = await pool.getConnection();
  try {
    const result = await conn.execute<Record<string, unknown>>(
      `SELECT a.CONSTRAINT_NAME, a.COLUMN_NAME,
              c_pk.TABLE_NAME AS REFERENCED_TABLE, b.COLUMN_NAME AS REFERENCED_COLUMN
       FROM USER_CONS_COLUMNS a
       JOIN USER_CONSTRAINTS c ON a.CONSTRAINT_NAME = c.CONSTRAINT_NAME
       JOIN USER_CONSTRAINTS c_pk ON c.R_CONSTRAINT_NAME = c_pk.CONSTRAINT_NAME
       JOIN USER_CONS_COLUMNS b ON c_pk.CONSTRAINT_NAME = b.CONSTRAINT_NAME AND a.POSITION = b.POSITION
       WHERE c.CONSTRAINT_TYPE = 'R' AND a.TABLE_NAME = :tname
       ORDER BY a.CONSTRAINT_NAME`,
      { tname: table.toUpperCase() },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return { supported: true, data: result.rows };
  } finally {
    await conn.close();
  }
}

export async function getTableSchema(pool: OracleDb.Pool, table: string): Promise<IntrospectionResult> {
  const oracledb = await getOracleDb();
  const conn = await pool.getConnection();
  try {
    const result = await conn.execute<Record<string, unknown>>(
      `SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH, DATA_DEFAULT, NULLABLE
       FROM USER_TAB_COLUMNS
       WHERE TABLE_NAME = :tname
       ORDER BY COLUMN_ID`,
      { tname: table.toUpperCase() },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return { supported: true, data: result.rows };
  } finally {
    await conn.close();
  }
}

export async function getRowCount(pool: OracleDb.Pool, table: string): Promise<IntrospectionResult> {
  const oracledb = await getOracleDb();
  const conn = await pool.getConnection();
  try {
    const result = await conn.execute<Record<string, unknown>>(
      `SELECT NUM_ROWS AS APPROXIMATE_COUNT FROM USER_TABLES WHERE TABLE_NAME = :tname`,
      { tname: table.toUpperCase() },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return { supported: true, data: (result.rows ?? [])[0] ?? { APPROXIMATE_COUNT: 0 } };
  } finally {
    await conn.close();
  }
}

export async function getVersion(pool: OracleDb.Pool): Promise<IntrospectionResult> {
  const oracledb = await getOracleDb();
  const conn = await pool.getConnection();
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
