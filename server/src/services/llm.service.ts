import { config } from '../config';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../utils/logger';

const log = logger.child('llm');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmCompletionOptions {
  messages: LlmMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface LlmCompletionResult {
  content: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number };
}

// ---------------------------------------------------------------------------
// Provider defaults
// ---------------------------------------------------------------------------

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  ollama: 'llama3.1:8b',
  'openai-compatible': '',
};

const FIXED_BASE_URLS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Check whether an AI provider is configured. */
export function isConfigured(): boolean {
  return !!config.ai.provider;
}

/** Return the display name of the current provider. */
export function getProviderName(): string {
  return config.ai.provider || 'none';
}

/** Send a completion request to the configured LLM provider. */
export async function complete(options: LlmCompletionOptions): Promise<LlmCompletionResult> {
  const { provider, apiKey, baseUrl } = config.ai;
  const model = config.ai.model || DEFAULT_MODELS[provider] || '';
  const maxTokens = options.maxTokens ?? config.ai.maxTokens;
  const temperature = options.temperature ?? config.ai.temperature;

  if (!provider) {
    throw new AppError(
      'AI query optimization is not available. An administrator must configure an AI/LLM provider in Settings.',
      503,
    );
  }

  if (provider !== 'ollama' && !apiKey) {
    throw new AppError('AI API key is not configured.', 503);
  }

  if ((provider === 'ollama' || provider === 'openai-compatible') && !baseUrl) {
    throw new AppError(`AI base URL is required for ${provider}.`, 503);
  }

  if (!model) {
    throw new AppError('AI model is not configured and no default is available for this provider.', 503);
  }

  const start = Date.now();

  try {
    let result: LlmCompletionResult;

    if (provider === 'anthropic') {
      result = await callAnthropic(options.messages, model, maxTokens, temperature, apiKey);
    } else {
      // openai, ollama, openai-compatible all use the OpenAI chat completions format
      const url = FIXED_BASE_URLS[provider] || baseUrl;
      const key = provider === 'ollama' ? undefined : apiKey;
      result = await callOpenAiCompatible(options.messages, model, maxTokens, temperature, url, key);
    }

    const elapsed = Date.now() - start;
    log.verbose(
      `LLM response: provider=${provider} model=${result.model} ` +
      `tokens=${result.usage?.promptTokens ?? '?'}+${result.usage?.completionTokens ?? '?'} ` +
      `elapsed=${elapsed}ms`,
    );

    return result;
  } catch (err) {
    if (err instanceof AppError) throw err;
    const elapsed = Date.now() - start;
    log.error(`LLM request failed: provider=${provider} elapsed=${elapsed}ms`);
    throw new AppError('Failed to connect to AI service.', 502);
  }
}

// ---------------------------------------------------------------------------
// Anthropic Messages API
// ---------------------------------------------------------------------------

async function callAnthropic(
  messages: LlmMessage[],
  model: string,
  maxTokens: number,
  temperature: number,
  apiKey: string,
): Promise<LlmCompletionResult> {
  // Anthropic uses a top-level `system` field, not a system message in the array
  const systemMsg = messages.find((m) => m.role === 'system');
  const nonSystemMessages = messages.filter((m) => m.role !== 'system');

  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    ...(systemMsg && { system: systemMsg.content }),
    messages: nonSystemMessages.map((m) => ({ role: m.role, content: m.content })),
  };

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.ai.timeoutMs),
  });

  if (!resp.ok) {
    const status = resp.status;
    log.error(`Anthropic API error: status=${status}`);
    throw new AppError(`AI service returned an error (status ${status}).`, 502);
  }

  const json = await resp.json() as {
    content: { type: string; text: string }[];
    model: string;
    usage?: { input_tokens: number; output_tokens: number };
  };

  return {
    content: json.content?.[0]?.text ?? '',
    model: json.model,
    usage: json.usage
      ? { promptTokens: json.usage.input_tokens, completionTokens: json.usage.output_tokens }
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// OpenAI-compatible Chat Completions API (OpenAI, Ollama, custom)
// ---------------------------------------------------------------------------

async function callOpenAiCompatible(
  messages: LlmMessage[],
  model: string,
  maxTokens: number,
  temperature: number,
  baseUrl: string,
  apiKey?: string,
): Promise<LlmCompletionResult> {
  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  };

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey) {
    headers['authorization'] = `Bearer ${apiKey}`;
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.ai.timeoutMs),
  });

  if (!resp.ok) {
    const status = resp.status;
    log.error(`OpenAI-compatible API error: status=${status} url=${url}`);
    throw new AppError(`AI service returned an error (status ${status}).`, 502);
  }

  const json = await resp.json() as {
    choices: { message: { content: string } }[];
    model: string;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  return {
    content: json.choices?.[0]?.message?.content ?? '',
    model: json.model ?? model,
    usage: json.usage
      ? { promptTokens: json.usage.prompt_tokens, completionTokens: json.usage.completion_tokens }
      : undefined,
  };
}
