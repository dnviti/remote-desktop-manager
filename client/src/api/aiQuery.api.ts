import api from './client';

export interface AiConfig {
  provider: string;
  hasApiKey: boolean;
  modelId: string;
  baseUrl: string | null;
  maxTokensPerRequest: number;
  dailyRequestLimit: number;
  enabled: boolean;
}

export interface AiConfigUpdate {
  provider?: string;
  apiKey?: string;
  modelId?: string;
  baseUrl?: string | null;
  maxTokensPerRequest?: number;
  dailyRequestLimit?: number;
  enabled?: boolean;
}

export interface AiGenerateResult {
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

export async function generateQuery(
  sessionId: string,
  prompt: string,
  dbProtocol?: string,
): Promise<AiGenerateResult> {
  const { data } = await api.post('/ai/generate-query', {
    sessionId,
    prompt,
    dbProtocol,
  });
  return data;
}
