import api from './client';

export type AiProvider =
  | 'none'
  | 'anthropic'
  | 'openai'
  | 'ollama'
  | 'openai-compatible';

export interface AiBackendConfig {
  name: string;
  provider: AiProvider;
  hasApiKey: boolean;
  baseUrl?: string | null;
  defaultModel?: string;
}

export interface AiFeatureConfig {
  enabled: boolean;
  backend?: string;
  modelId?: string;
  maxTokensPerRequest: number;
  dailyRequestLimit?: number;
}

export interface AiConfig {
  backends: AiBackendConfig[];
  queryGeneration: AiFeatureConfig;
  queryOptimizer: AiFeatureConfig;
  temperature: number;
  timeoutMs: number;

  provider: AiProvider;
  hasApiKey: boolean;
  modelId: string;
  baseUrl: string | null;
  maxTokensPerRequest: number;
  dailyRequestLimit: number;
  enabled: boolean;
}

export interface AiBackendUpdate {
  name: string;
  provider: AiProvider;
  apiKey?: string;
  clearApiKey?: boolean;
  baseUrl?: string | null;
  defaultModel?: string | null;
}

export interface AiFeatureUpdate {
  enabled: boolean;
  backend?: string;
  modelId?: string;
  maxTokensPerRequest?: number;
  dailyRequestLimit?: number;
}

export interface AiConfigUpdate {
  backends: AiBackendUpdate[];
  queryGeneration: AiFeatureUpdate;
  queryOptimizer: AiFeatureUpdate;
  temperature: number;
  timeoutMs: number;
}

export interface ObjectRequest {
  name: string;
  schema: string;
  reason: string;
}

export interface AiAnalyzeResult {
  status: 'pending_approval';
  conversationId: string;
  objectRequests: ObjectRequest[];
}

export interface AiGenerateResult {
  status: 'complete';
  sql: string;
  explanation: string;
  firewallWarning?: string;
}

export async function getAiConfig(): Promise<AiConfig> {
  const { data } = await api.get('/ai/config');
  return data;
}

export async function updateAiConfig(update: AiConfigUpdate): Promise<AiConfig> {
  const { data } = await api.put('/ai/config', update);
  return data;
}

export async function analyzeQuery(
  sessionId: string,
  prompt: string,
  dbProtocol?: string,
): Promise<AiAnalyzeResult> {
  const { data } = await api.post('/ai/generate-query', {
    sessionId,
    prompt,
    dbProtocol,
  });
  return data;
}

export async function confirmGeneration(
  conversationId: string,
  approvedObjects: string[],
): Promise<AiGenerateResult> {
  const { data } = await api.post('/ai/generate-query/confirm', {
    conversationId,
    approvedObjects,
  });
  return data;
}

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
