import pg from 'pg';
import mysql from 'mysql2/promise';
import { MongoClient } from 'mongodb';
import mssql from 'mssql';
import oracledb from 'oracledb';
import { AppError } from '../middleware/error.middleware';
import { getConnectionCredentials } from './connection.service';
import { logger } from '../utils/logger';
import { config } from '../config';
import type { DbProtocol, DbSettings } from '../types';
import type { QueryResult, SchemaInfo, TableInfo } from './dbSession.service';

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

type DriverPool =
  | { type: 'postgresql'; pool: pg.Pool }
  | { type: 'mysql'; pool: mysql.Pool }
  | { type: 'mongodb'; client: MongoClient; dbName: string }
  | { type: 'mssql'; pool: mssql.ConnectionPool }
  | { type: 'oracle'; pool: oracledb.Pool }
  | { type: 'db2'; conn: unknown; dbName: string };

interface ManagedPool {
  sessionId: string;
  protocol: DbProtocol;
  driver: DriverPool;
  createdAt: Date;
  lastUsedAt: Date;
}

// ---------------------------------------------------------------------------
// In-memory pool registry
// ---------------------------------------------------------------------------

const pools = new Map<string, ManagedPool>();

// ---------------------------------------------------------------------------
// Pool creation (per protocol)
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
  const maxConn = config.dbPoolMaxConnections;
  const idleTimeout = config.dbPoolIdleTimeoutMs;
  const queryTimeout = config.dbQueryTimeoutMs;

  switch (protocol) {
    case 'postgresql': {
      const pool = new pg.Pool({
        host,
        port,
        user: username,
        password,
        database: databaseName,
        max: maxConn,
        idleTimeoutMillis: idleTimeout,
        statement_timeout: queryTimeout,
      });
      // Verify connectivity
      const client = await pool.connect();
      client.release();
      return { type: 'postgresql', pool };
    }

    case 'mysql': {
      const pool = mysql.createPool({
        host,
        port,
        user: username,
        password,
        database: databaseName,
        connectionLimit: maxConn,
        waitForConnections: true,
        idleTimeout,
      });
      // Verify connectivity
      const conn = await pool.getConnection();
      conn.release();
      return { type: 'mysql', pool };
    }

    case 'mongodb': {
      const dbName = databaseName || 'admin';
      const uri = `mongodb://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}/${dbName}`;
      const client = new MongoClient(uri, {
        maxPoolSize: maxConn,
        maxIdleTimeMS: idleTimeout,
        serverSelectionTimeoutMS: queryTimeout,
      });
      await client.connect();
      return { type: 'mongodb', client, dbName };
    }

    case 'mssql': {
      const mssqlConfig: mssql.config = {
        server: host,
        port,
        user: username,
        password,
        database: databaseName,
        pool: { max: maxConn, idleTimeoutMillis: idleTimeout },
        options: {
          encrypt: false,
          trustServerCertificate: true,
          requestTimeout: queryTimeout,
          instanceName: dbSettings?.mssqlInstanceName,
        },
      };
      const pool = await new mssql.ConnectionPool(mssqlConfig).connect();
      return { type: 'mssql', pool };
    }

    case 'oracle': {
      oracledb.initOracleClient?.();
      let connectString: string;
      if (dbSettings?.oracleServiceName) {
        connectString = `${host}:${port}/${dbSettings.oracleServiceName}`;
      } else if (dbSettings?.oracleSid) {
        connectString = `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${host})(PORT=${port}))(CONNECT_DATA=(SID=${dbSettings.oracleSid})))`;
      } else {
        connectString = `${host}:${port}/${databaseName || 'ORCL'}`;
      }
      const pool = await oracledb.createPool({
        user: username,
        password,
        connectString,
        poolMin: 0,
        poolMax: maxConn,
        poolTimeout: Math.floor(idleTimeout / 1000),
      });
      return { type: 'oracle', pool };
    }

    case 'db2': {
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
      const connStr = `DATABASE=${dbName};HOSTNAME=${host};PORT=${port};PROTOCOL=TCPIP;UID=${username};PWD=${password};QueryTimeout=${Math.floor(queryTimeout / 1000)}`;
      const conn = ibmDb.openSync(connStr);
      return { type: 'db2', conn, dbName };
    }

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
    createdAt: new Date(),
    lastUsedAt: new Date(),
  };

  pools.set(params.sessionId, managed);
  log.info(`Connection pool created for session ${params.sessionId} (${protocol})`);
  return managed;
}

function pickDbSettingsFields(meta: Record<string, unknown>): Partial<DbSettings> {
  const fields: Partial<DbSettings> = {};
  if (meta.oracleSid) fields.oracleSid = meta.oracleSid as string;
  if (meta.oracleServiceName) fields.oracleServiceName = meta.oracleServiceName as string;
  if (meta.mssqlInstanceName) fields.mssqlInstanceName = meta.mssqlInstanceName as string;
  if (meta.mssqlAuthMode) fields.mssqlAuthMode = meta.mssqlAuthMode as 'sql' | 'windows';
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

  let result: QueryResult;
  try {
    switch (driver.type) {
      case 'postgresql':
        result = await runPostgresQuery(driver.pool, sql, maxRows);
        break;

      case 'mysql':
        result = await runMysqlQuery(driver.pool, sql, maxRows);
        break;

      case 'mongodb':
        result = await runMongoQuery(driver.client, driver.dbName, sql, maxRows);
        break;

      case 'mssql':
        result = await runMssqlQuery(driver.pool, sql, maxRows);
        break;

      case 'oracle':
        result = await runOracleQuery(driver.pool, sql, maxRows, timeoutMs);
        break;

      case 'db2':
        result = await runDb2Query(driver.conn, sql, maxRows);
        break;

      default:
        throw new AppError('Unsupported protocol', 400);
    }
    result.durationMs = Date.now() - startTime;
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Query execution failed';
    throw new AppError(message, 400);
  } finally {
    const elapsed = Date.now() - startTime;
    log.debug?.(`Query executed in ${elapsed}ms for session ${managed.sessionId}`);
  }
  return result;
}

// --- PostgreSQL ---

async function runPostgresQuery(pool: pg.Pool, sql: string, maxRows: number): Promise<QueryResult> {
  // codeql[js/sql-injection] — sql is validated by role-based query restriction and
  // sqlFirewall.evaluateQuery() in dbSession.service.ts before reaching this function.
  const result = await pool.query(sql);
  const columns = result.fields?.map((f) => f.name) ?? [];
  const allRows = (result.rows ?? []) as Record<string, unknown>[];
  const truncated = allRows.length > maxRows;
  const rows = truncated ? allRows.slice(0, maxRows) : allRows;
  return {
    columns,
    rows,
    rowCount: result.rowCount ?? allRows.length,
    durationMs: 0,
    truncated,
  };
}

// --- MySQL ---

async function runMysqlQuery(pool: mysql.Pool, sql: string, maxRows: number): Promise<QueryResult> {
  // codeql[js/sql-injection] — sql is validated by role-based query restriction and
  // sqlFirewall.evaluateQuery() in dbSession.service.ts before reaching this function.
  const [rawRows, fields] = await pool.query(sql);
  const fieldList = Array.isArray(fields) ? fields : [];
  const columns = fieldList.map((f) => f.name);
  const allRows = Array.isArray(rawRows) ? (rawRows as Record<string, unknown>[]) : [];
  const truncated = allRows.length > maxRows;
  const rows = truncated ? allRows.slice(0, maxRows) : allRows;
  return {
    columns,
    rows,
    rowCount: allRows.length,
    durationMs: 0,
    truncated,
  };
}

// --- MongoDB ---

async function runMongoQuery(
  client: MongoClient,
  dbName: string,
  input: string,
  maxRows: number,
): Promise<QueryResult> {
  const db = client.db(dbName);
  let command: Record<string, unknown>;
  try {
    command = JSON.parse(input) as Record<string, unknown>;
  } catch {
    throw new AppError(
      'MongoDB requires JSON command input, e.g.: { "find": "collection", "filter": {} }',
      400,
    );
  }

  const result = await db.command(command);

  // Normalize result into rows
  let allRows: Record<string, unknown>[] = [];
  if (result.cursor?.firstBatch) {
    allRows = result.cursor.firstBatch as Record<string, unknown>[];
  } else if (Array.isArray(result.values)) {
    allRows = result.values as Record<string, unknown>[];
  } else {
    // Single result — wrap as a row
    allRows = [result as Record<string, unknown>];
  }

  const truncated = allRows.length > maxRows;
  const rows = truncated ? allRows.slice(0, maxRows) : allRows;
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return {
    columns,
    rows,
    rowCount: allRows.length,
    durationMs: 0,
    truncated,
  };
}

// --- MSSQL ---

async function runMssqlQuery(
  pool: mssql.ConnectionPool,
  sql: string,
  maxRows: number,
): Promise<QueryResult> {
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
  return {
    columns,
    rows,
    rowCount: result.rowsAffected?.[0] ?? allRows.length,
    durationMs: 0,
    truncated,
  };
}

// --- Oracle ---

async function runOracleQuery(
  pool: oracledb.Pool,
  sql: string,
  maxRows: number,
  timeoutMs: number,
): Promise<QueryResult> {
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
    return {
      columns,
      rows,
      rowCount: result.rowsAffected ?? allRows.length,
      durationMs: 0,
      truncated,
    };
  } finally {
    await conn.close();
  }
}

// --- DB2 ---

async function runDb2Query(
  conn: unknown,
  sql: string,
  maxRows: number,
): Promise<QueryResult> {
  // ibm_db is dynamically imported — conn is an ibm_db.Database instance
  // codeql[js/sql-injection] — sql is validated by role-based query restriction and
  // sqlFirewall.evaluateQuery() in dbSession.service.ts before reaching this function.
  const db2Conn = conn as { querySync: (sql: string) => Record<string, unknown>[] };
  const allRows = db2Conn.querySync(sql);
  const columns = allRows.length > 0 ? Object.keys(allRows[0]) : [];
  const truncated = allRows.length > maxRows;
  const rows = truncated ? allRows.slice(0, maxRows) : allRows;
  return {
    columns,
    rows,
    rowCount: allRows.length,
    durationMs: 0,
    truncated,
  };
}

// ---------------------------------------------------------------------------
// Schema fetching
// ---------------------------------------------------------------------------

export async function fetchSchema(managed: ManagedPool): Promise<SchemaInfo> {
  const { driver } = managed;

  try {
    switch (driver.type) {
      case 'postgresql':
        return await fetchPostgresSchema(driver.pool);
      case 'mysql':
        return await fetchMysqlSchema(driver.pool);
      case 'mongodb':
        return await fetchMongoSchema(driver.client, driver.dbName);
      case 'mssql':
        return await fetchMssqlSchema(driver.pool);
      case 'oracle':
        return await fetchOracleSchema(driver.pool);
      case 'db2':
        return await fetchDb2Schema(driver.conn);
      default:
        return { tables: [] };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Schema fetch failed';
    log.warn(`Schema fetch failed for session ${managed.sessionId}: ${message}`);
    return { tables: [] };
  }
}

async function fetchPostgresSchema(pool: pg.Pool): Promise<SchemaInfo> {
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

async function fetchMysqlSchema(pool: mysql.Pool): Promise<SchemaInfo> {
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

async function fetchMongoSchema(client: MongoClient, dbName: string): Promise<SchemaInfo> {
  const db = client.db(dbName);
  const collections = await db.listCollections().toArray();
  const tables: TableInfo[] = [];
  for (const col of collections) {
    // Sample one document to infer field names
    const sample = await db.collection(col.name).findOne();
    const columns = sample
      ? Object.keys(sample).map((k) => ({
          name: k,
          dataType: typeof sample[k],
          nullable: true,
          isPrimaryKey: k === '_id',
        }))
      : [];
    tables.push({ name: col.name, schema: dbName, columns });
  }
  return { tables };
}

async function fetchMssqlSchema(pool: mssql.ConnectionPool): Promise<SchemaInfo> {
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

async function fetchOracleSchema(pool: oracledb.Pool): Promise<SchemaInfo> {
  const conn = await pool.getConnection();
  try {
    const tablesResult = await conn.execute<{ OWNER: string; TABLE_NAME: string }>(
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
            WHERE OWNER = :owner AND TABLE_NAME = :table AND CONSTRAINT_TYPE = 'P'
          )
        WHERE c.OWNER = :owner AND c.TABLE_NAME = :table
        ORDER BY c.COLUMN_ID`,
        { owner: t.OWNER, table: t.TABLE_NAME },
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

async function fetchDb2Schema(conn: unknown): Promise<SchemaInfo> {
  const db2Conn = conn as { querySync: (sql: string) => Record<string, unknown>[] };
  const tableRows = db2Conn.querySync(
    `SELECT TABSCHEMA AS table_schema, TABNAME AS table_name
     FROM SYSCAT.TABLES WHERE TYPE = 'T'
       AND TABSCHEMA NOT IN ('SYSIBM','SYSCAT','SYSSTAT','SYSPUBLIC','SYSFUN','SYSTOOLS')
     ORDER BY TABSCHEMA, TABNAME`,
  );
  const tables: TableInfo[] = [];
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
        await managed.driver.pool.end();
        break;
      case 'mysql':
        await managed.driver.pool.end();
        break;
      case 'mongodb':
        await managed.driver.client.close();
        break;
      case 'mssql':
        await managed.driver.pool.close();
        break;
      case 'oracle':
        await managed.driver.pool.close(0);
        break;
      case 'db2': {
        const db2Conn = managed.driver.conn as { closeSync?: () => void };
        db2Conn.closeSync?.();
        break;
      }
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
