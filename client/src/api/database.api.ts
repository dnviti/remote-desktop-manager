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
  views?: DbViewInfo[];
  functions?: DbRoutineInfo[];
  procedures?: DbRoutineInfo[];
  triggers?: DbTriggerInfo[];
  sequences?: DbSequenceInfo[];
  packages?: DbPackageInfo[];
  types?: DbTypeInfo[];
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

export interface DbViewInfo {
  name: string;
  schema: string;
  materialized?: boolean;
}

export interface DbRoutineInfo {
  name: string;
  schema: string;
  returnType?: string;
}

export interface DbTriggerInfo {
  name: string;
  schema: string;
  tableName: string;
  event: string;
  timing: string;
}

export interface DbSequenceInfo {
  name: string;
  schema: string;
}

export interface DbPackageInfo {
  name: string;
  schema: string;
  hasBody: boolean;
}

export interface DbTypeInfo {
  name: string;
  schema: string;
  kind: string;
}

export interface DbSessionConfig {
  activeDatabase?: string;
  timezone?: string;
  searchPath?: string;
  encoding?: string;
  initCommands?: string[];
}

export async function createDbSession(params: {
  connectionId: string;
  username?: string;
  password?: string;
  sessionConfig?: DbSessionConfig;
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

// ---------------------------------------------------------------------------
// Query history
// ---------------------------------------------------------------------------

export interface QueryHistoryEntry {
  id: string;
  queryText: string;
  queryType: string;
  executionTimeMs: number | null;
  rowsAffected: number | null;
  blocked: boolean;
  createdAt: string;
}

export async function getQueryHistory(
  sessionId: string,
  limit?: number,
  search?: string,
): Promise<QueryHistoryEntry[]> {
  const params: Record<string, string> = {};
  if (limit) params.limit = String(limit);
  if (search) params.search = search;
  const { data } = await api.get(`/sessions/database/${sessionId}/history`, { params });
  return data;
}

// ---------------------------------------------------------------------------
// Session configuration
// ---------------------------------------------------------------------------

export async function updateDbSessionConfig(
  sessionId: string,
  sessionConfig: DbSessionConfig,
): Promise<{ applied: boolean; activeDatabase?: string }> {
  const { data } = await api.put(`/sessions/database/${sessionId}/config`, { sessionConfig });
  return data;
}

export async function getDbSessionConfig(sessionId: string): Promise<DbSessionConfig> {
  const { data } = await api.get(`/sessions/database/${sessionId}/config`);
  return data;
}

export async function introspectDatabase(
  sessionId: string,
  type: IntrospectionType,
  target: string,
): Promise<IntrospectionResponse> {
  const { data } = await api.post(`/sessions/database/${sessionId}/introspect`, { type, target });
  return data;
}
