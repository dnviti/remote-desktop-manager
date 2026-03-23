import { MongoClient } from 'mongodb';
import { AppError } from '../../middleware/error.middleware';
import { config } from '../../config';
import type { DbSettings } from '../../types';
import type { QueryResult, SchemaInfo, ViewInfo } from '../dbSession.service';
import type { DriverPool } from './types';

export async function createPool(
  host: string, port: number, username: string, password: string,
  databaseName: string | undefined, _dbSettings: DbSettings | undefined,
): Promise<DriverPool> {
  const dbName = databaseName || 'admin';
  const uri = `mongodb://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}/${dbName}`;
  const client = new MongoClient(uri, {
    maxPoolSize: config.dbPoolMaxConnections,
    maxIdleTimeMS: config.dbPoolIdleTimeoutMs,
    serverSelectionTimeoutMS: config.dbQueryTimeoutMs,
  });
  await client.connect();
  return { type: 'mongodb', client, dbName };
}

export async function runQuery(
  client: MongoClient, dbName: string, input: string, maxRows: number,
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

  let allRows: Record<string, unknown>[] = [];
  if (result.cursor?.firstBatch) {
    allRows = result.cursor.firstBatch as Record<string, unknown>[];
  } else if (Array.isArray(result.values)) {
    allRows = result.values as Record<string, unknown>[];
  } else {
    allRows = [result as Record<string, unknown>];
  }

  const truncated = allRows.length > maxRows;
  const rows = truncated ? allRows.slice(0, maxRows) : allRows;
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return { columns, rows, rowCount: allRows.length, durationMs: 0, truncated };
}

export async function fetchSchema(client: MongoClient, dbName: string): Promise<SchemaInfo> {
  const db = client.db(dbName);
  const collections = await db.listCollections({ type: 'collection' }).toArray();
  const tables: SchemaInfo['tables'] = [];
  for (const col of collections) {
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

  let views: ViewInfo[] = [];
  try {
    const viewList = await db.listCollections({ type: 'view' }).toArray();
    views = viewList.map((c) => ({ name: c.name, schema: dbName }));
  } catch {
    /* best-effort: views not supported on older MongoDB versions */
  }

  return { tables, views };
}

export async function destroyPool(client: MongoClient): Promise<void> {
  await client.close();
}
