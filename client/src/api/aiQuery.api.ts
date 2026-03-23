import api from './client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DataRequest {
  type: string;
  target: string;
  reason: string;
}

export interface OptimizeQueryParams {
  sql: string;
  executionPlan: unknown;
  sessionId: string;
  dbProtocol: string;
  dbVersion?: string;
  schemaContext?: unknown;
}

export interface OptimizeQueryResult {
  status: 'needs_data' | 'complete';
  conversationId: string;
  dataRequests?: DataRequest[];
  optimizedSql?: string;
  explanation?: string;
  changes?: string[];
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

export async function optimizeQuery(params: OptimizeQueryParams): Promise<OptimizeQueryResult> {
  const { data } = await api.post('/ai/optimize-query', params);
  return data;
}

export async function continueOptimization(
  conversationId: string,
  approvedData: Record<string, unknown>,
): Promise<OptimizeQueryResult> {
  const { data } = await api.post('/ai/optimize-query/continue', { conversationId, approvedData });
  return data;
}
