import { logger } from '../../utils/logger';

const log = logger.child('ai:anthropic');

export interface AnthropicConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  timeoutMs: number;
}

export interface AiGenerateResult {
  sql: string;
  explanation: string;
}

export function createGenerateFn(cfg: AnthropicConfig) {
  return async (systemPrompt: string, userPrompt: string): Promise<AiGenerateResult> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': cfg.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: cfg.maxTokens,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        log.error(`Anthropic API error: status ${res.status}`);
        throw new Error(`Anthropic API returned ${res.status}: ${errBody.slice(0, 200)}`);
      }

      const body = await res.json() as {
        content: Array<{ type: string; text?: string }>;
      };

      const textBlock = body.content.find((b) => b.type === 'text');
      const raw = textBlock?.text ?? '';

      return parseAiResponse(raw);
    } finally {
      clearTimeout(timer);
    }
  };
}

function parseAiResponse(raw: string): AiGenerateResult {
  // Try to extract JSON from the response
  const jsonMatch = raw.match(/\{[\s\S]*"sql"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { sql?: string; explanation?: string };
      if (parsed.sql) {
        return {
          sql: parsed.sql.trim(),
          explanation: parsed.explanation?.trim() ?? '',
        };
      }
    } catch {
      // Fall through to text parsing
    }
  }

  // Extract SQL from code block
  const sqlMatch = raw.match(/```sql\s*([\s\S]*?)```/i) ?? raw.match(/```\s*([\s\S]*?)```/);
  const sql = sqlMatch ? sqlMatch[1].trim() : raw.trim();

  // Everything after the code block is explanation
  const afterBlock = sqlMatch ? raw.slice(raw.indexOf('```', raw.indexOf('```') + 3) + 3).trim() : '';

  return {
    sql,
    explanation: afterBlock || '',
  };
}
