import { logger } from '../../utils/logger';

const log = logger.child('ai:openai');

export interface OpenAiConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  maxTokens: number;
  timeoutMs: number;
}

export interface AiGenerateResult {
  sql: string;
  explanation: string;
}

export function createGenerateFn(cfg: OpenAiConfig) {
  const baseUrl = cfg.baseUrl.replace(/\/+$/, '');

  return async (systemPrompt: string, userPrompt: string): Promise<AiGenerateResult> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: cfg.maxTokens,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        log.error(`OpenAI API error: status ${res.status}`);
        throw new Error(`OpenAI API returned ${res.status}: ${errBody.slice(0, 200)}`);
      }

      const body = await res.json() as {
        choices: Array<{ message: { content: string } }>;
      };

      const raw = body.choices?.[0]?.message?.content ?? '';

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
