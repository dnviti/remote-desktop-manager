import api from './client';

export interface DbSessionResult {
  sessionId: string;
  proxyHost: string;
  proxyPort: number;
  protocol: string;
  databaseName?: string;
  username: string;
}

export interface DbQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  durationMs: number;
  truncated: boolean;
}

export interface DbSchemaInfo {
  tables: DbTableInfo[];
}

export interface DbTableInfo {
  name: string;
  schema: string;
  columns: DbColumnInfo[];
}

export interface DbColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
}

export async function createDbSession(params: {
  connectionId: string;
  username?: string;
  password?: string;
}): Promise<DbSessionResult> {
  const { data } = await api.post('/sessions/database', params);
  return data;
}

export async function endDbSession(sessionId: string): Promise<{ ok: boolean }> {
  const { data } = await api.post(`/sessions/database/${sessionId}/end`);
  return data;
}

export async function dbSessionHeartbeat(sessionId: string): Promise<{ ok: boolean }> {
  const { data } = await api.post(`/sessions/database/${sessionId}/heartbeat`);
  return data;
}

export async function executeDbQuery(sessionId: string, sql: string): Promise<DbQueryResult> {
  const { data } = await api.post(`/sessions/database/${sessionId}/query`, { sql });
  return data;
}

export async function getDbSchema(sessionId: string): Promise<DbSchemaInfo> {
  const { data } = await api.get(`/sessions/database/${sessionId}/schema`);
  return data;
}

// ---------------------------------------------------------------------------
// Execution plan
// ---------------------------------------------------------------------------

export interface ExecutionPlanResponse {
  supported: boolean;
  plan?: unknown;
  format?: 'json' | 'xml' | 'text';
  raw?: string;
}

export async function getExecutionPlan(sessionId: string, sql: string): Promise<ExecutionPlanResponse> {
  const { data } = await api.post(`/sessions/database/${sessionId}/explain`, { sql });
  return data;
}

// ---------------------------------------------------------------------------
// Database introspection
// ---------------------------------------------------------------------------

export type IntrospectionType =
  | 'indexes'
  | 'statistics'
  | 'foreign_keys'
  | 'table_schema'
  | 'row_count'
  | 'database_version';

export interface IntrospectionResponse {
  supported: boolean;
  data?: unknown;
}

export async function introspectDatabase(
  sessionId: string,
  type: IntrospectionType,
  target: string,
): Promise<IntrospectionResponse> {
  const { data } = await api.post(`/sessions/database/${sessionId}/introspect`, { type, target });
  return data;
}
