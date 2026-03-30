import { config } from '../config';
import { AppError } from '../middleware/error.middleware';
import type { DbSessionConfig } from '../types';

export interface GoQueryRunnerRequest {
  sql: string;
  maxRows?: number;
  target: {
    protocol: 'postgresql';
    host: string;
    port: number;
    database?: string;
    sslMode?: 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full';
    username: string;
    password: string;
    sessionConfig?: DbSessionConfig;
  };
}

export interface GoQueryRunnerResponse {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  durationMs: number;
  truncated: boolean;
}

export interface GoExplainResponse {
  supported: boolean;
  plan?: unknown;
  format?: 'json' | 'xml' | 'text';
  raw?: string;
}

export interface GoIntrospectionResponse {
  supported: boolean;
  data?: unknown;
}

export interface GoSchemaColumn {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
}

export interface GoSchemaTable {
  name: string;
  schema: string;
  columns: GoSchemaColumn[];
}

export interface GoSchemaView {
  name: string;
  schema: string;
  materialized?: boolean;
}

export interface GoSchemaRoutine {
  name: string;
  schema: string;
  returnType?: string;
}

export interface GoSchemaTrigger {
  name: string;
  schema: string;
  tableName: string;
  event: string;
  timing: string;
}

export interface GoSchemaSequence {
  name: string;
  schema: string;
}

export interface GoSchemaPackage {
  name: string;
  schema: string;
  hasBody: boolean;
}

export interface GoSchemaType {
  name: string;
  schema: string;
  kind: string;
}

export interface GoSchemaResponse {
  tables: GoSchemaTable[];
  views: GoSchemaView[];
  functions: GoSchemaRoutine[];
  procedures: GoSchemaRoutine[];
  triggers: GoSchemaTrigger[];
  sequences: GoSchemaSequence[];
  packages: GoSchemaPackage[];
  types: GoSchemaType[];
}

function resolveUrl(): string {
  return config.goQueryRunnerUrl.replace(/\/+$/, '');
}

export async function executeReadOnlyQuery(req: GoQueryRunnerRequest): Promise<GoQueryRunnerResponse> {
  const response = await fetch(`${resolveUrl()}/v1/query-runs:execute`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (!response.ok) {
    let message = `Go query runner returned status ${response.status}`;
    try {
      const body = await response.json() as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // ignore malformed error body
    }
    throw new AppError(message, response.status >= 500 ? 502 : 400);
  }

  return await response.json() as GoQueryRunnerResponse;
}

export async function executeQuery(req: GoQueryRunnerRequest): Promise<GoQueryRunnerResponse> {
  const response = await fetch(`${resolveUrl()}/v1/query-runs:execute-any`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (!response.ok) {
    let message = `Go query runner returned status ${response.status}`;
    try {
      const body = await response.json() as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // ignore malformed error body
    }
    throw new AppError(message, response.status >= 500 ? 502 : 400);
  }

  return await response.json() as GoQueryRunnerResponse;
}

export async function fetchSchema(req: Pick<GoQueryRunnerRequest, 'target'>): Promise<GoSchemaResponse> {
  const response = await fetch(`${resolveUrl()}/v1/schema:fetch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (!response.ok) {
    let message = `Go query runner returned status ${response.status}`;
    try {
      const body = await response.json() as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // ignore malformed error body
    }
    throw new AppError(message, response.status >= 500 ? 502 : 400);
  }

  return await response.json() as GoSchemaResponse;
}

export async function explainQuery(req: GoQueryRunnerRequest): Promise<GoExplainResponse> {
  const response = await fetch(`${resolveUrl()}/v1/query-plans:explain`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (!response.ok) {
    let message = `Go query runner returned status ${response.status}`;
    try {
      const body = await response.json() as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // ignore malformed error body
    }
    throw new AppError(message, response.status >= 500 ? 502 : 400);
  }

  return await response.json() as GoExplainResponse;
}

export async function introspectQuery(req: {
  type: 'indexes' | 'statistics' | 'foreign_keys' | 'table_schema' | 'row_count' | 'database_version';
  target?: string;
  db: GoQueryRunnerRequest['target'];
}): Promise<GoIntrospectionResponse> {
  const response = await fetch(`${resolveUrl()}/v1/introspection:run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (!response.ok) {
    let message = `Go query runner returned status ${response.status}`;
    try {
      const body = await response.json() as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // ignore malformed error body
    }
    throw new AppError(message, response.status >= 500 ? 502 : 400);
  }

  return await response.json() as GoIntrospectionResponse;
}
