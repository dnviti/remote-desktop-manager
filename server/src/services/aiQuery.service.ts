import { config } from '../config';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/error.middleware';
import * as auditService from './audit.service';
import * as tenantAiConfigService from './tenantAiConfig.service';
import * as sqlFirewall from './sqlFirewall.service';
import { createGenerateFn as createAnthropicFn } from './ai/anthropic.provider';
import { createGenerateFn as createOpenAiFn } from './ai/openai.provider';
import type { TableInfo } from './dbSession.service';

const log = logger.child('aiQuery');

// ---------------------------------------------------------------------------
// Per-tenant daily request counters (resets at midnight UTC)
// ---------------------------------------------------------------------------
interface DailyCounter {
  count: number;
  resetAt: number;
}

const dailyCounters = new Map<string, DailyCounter>();

function getNextMidnight(): number {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.getTime();
}

function incrementDailyCounter(tenantId: string, limit: number): void {
  const now = Date.now();
  let counter = dailyCounters.get(tenantId);

  if (!counter || now >= counter.resetAt) {
    counter = { count: 0, resetAt: getNextMidnight() };
    dailyCounters.set(tenantId, counter);
  }

  if (counter.count >= limit) {
    throw new AppError('Daily AI query generation limit reached for this tenant', 429);
  }

  counter.count++;
}

// ---------------------------------------------------------------------------
// Schema formatting
// ---------------------------------------------------------------------------
function formatSchemaContext(tables: TableInfo[], dbProtocol: string): string {
  if (!tables.length) return 'No schema information available.';

  const lines: string[] = [`Database type: ${dbProtocol}`, '', 'Schema:'];

  for (const table of tables.slice(0, 50)) {
    const qualifiedName = table.schema && table.schema !== 'public'
      ? `${table.schema}.${table.name}`
      : table.name;

    const cols = table.columns
      .map((c) => {
        const nullable = c.nullable ? ' NULL' : ' NOT NULL';
        const pk = c.isPrimaryKey ? ' PK' : '';
        return `  ${c.name} ${c.dataType}${nullable}${pk}`;
      })
      .join('\n');

    lines.push(`\nTABLE ${qualifiedName}:`);
    lines.push(cols);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------
function buildSystemPrompt(dbProtocol: string): string {
  const dialect = dbProtocol.toUpperCase();
  return `You are a SQL query assistant. You generate SQL queries from natural language descriptions.

RULES:
1. ONLY generate SELECT queries. NEVER generate INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE, or any DML/DDL statements.
2. Use the correct SQL dialect for ${dialect}.
3. Always use the table and column names from the provided schema — do not invent names.
4. If the request is ambiguous, make reasonable assumptions and explain them.
5. Always add reasonable LIMIT clauses when the user does not specify one (default to LIMIT 100).
6. Use table aliases for readability.
7. Return your response as a JSON object with two fields:
   - "sql": the generated SELECT query
   - "explanation": a brief explanation of what the query does and any assumptions made

Example response:
{"sql": "SELECT o.id, o.total FROM orders o WHERE o.created_at >= NOW() - INTERVAL '1 month' AND o.total > 1000 LIMIT 100;", "explanation": "Retrieves orders from the last month with totals over $1000, limited to 100 results."}`;
}

// ---------------------------------------------------------------------------
// Main generation function
// ---------------------------------------------------------------------------
export interface GenerateParams {
  tenantId: string;
  userId: string;
  prompt: string;
  schema: TableInfo[];
  dbProtocol: string;
  ipAddress?: string;
}

export interface GenerateResult {
  sql: string;
  explanation: string;
  firewallWarning?: string;
}

export async function generateSqlFromPrompt(params: GenerateParams): Promise<GenerateResult> {
  const { tenantId, userId, prompt, schema, dbProtocol, ipAddress } = params;

  // 1. Get tenant AI configuration
  const tenantCfg = await tenantAiConfigService.getFullConfig(tenantId);

  // 2. Check if feature is enabled (env-level OR tenant-level)
  if (!config.aiQueryEnabled && !tenantCfg?.enabled) {
    throw new AppError('AI query generation is not enabled', 403);
  }

  // Determine effective provider and API key
  const provider = tenantCfg?.provider ?? config.aiQueryProvider;
  let apiKey = tenantCfg?.apiKey ?? '';
  let model = tenantCfg?.modelId ?? config.aiModelVersion;
  let baseUrl = tenantCfg?.baseUrl ?? config.aiOpenaiBaseUrl;
  const maxTokens = tenantCfg?.maxTokensPerRequest ?? 4000;
  const dailyLimit = tenantCfg?.dailyRequestLimit ?? config.aiMaxRequestsPerDay;
  const timeoutMs = config.aiQueryTimeoutMs;

  // Fall back to env-level keys if tenant has no key
  if (!apiKey) {
    if (provider === 'anthropic' && config.aiAnthropicApiKey) {
      apiKey = config.aiAnthropicApiKey;
    } else if (provider === 'openai' && config.aiOpenaiApiKey) {
      apiKey = config.aiOpenaiApiKey;
    }
  }

  if (provider === 'none' || !apiKey) {
    throw new AppError('No AI provider is configured. Please set up an AI provider in Settings.', 400);
  }

  // Defaults per provider
  if (!model) {
    model = provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o';
  }
  if (provider === 'openai' && !baseUrl) {
    baseUrl = 'https://api.openai.com/v1';
  }

  // 3. Rate-limit check
  incrementDailyCounter(tenantId, dailyLimit);

  // 4. Build prompts
  const systemPrompt = buildSystemPrompt(dbProtocol);
  const schemaContext = formatSchemaContext(schema, dbProtocol);
  const userPrompt = `${schemaContext}\n\nUser request: ${prompt}`;

  // 5. Call provider
  let result: { sql: string; explanation: string };
  try {
    if (provider === 'anthropic') {
      const generateFn = createAnthropicFn({ apiKey, model, maxTokens, timeoutMs });
      result = await generateFn(systemPrompt, userPrompt);
    } else {
      const generateFn = createOpenAiFn({
        apiKey,
        model,
        baseUrl: baseUrl ?? 'https://api.openai.com/v1',
        maxTokens,
        timeoutMs,
      });
      result = await generateFn(systemPrompt, userPrompt);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error(`AI query generation failed: ${message}`);
    throw new AppError(`AI query generation failed: ${message}`, 502);
  }

  // 6. Validate that it's actually a SELECT query
  const normalizedSql = result.sql.replace(/^\s*--.*/gm, '').trim();
  const firstWord = normalizedSql.split(/\s+/)[0]?.toUpperCase();
  if (firstWord !== 'SELECT' && firstWord !== 'WITH' && firstWord !== '(') {
    log.warn(`AI generated non-SELECT query, blocking: first word was "${firstWord}"`);
    throw new AppError(
      'The AI generated a non-SELECT query. Only SELECT queries are allowed.',
      400,
    );
  }

  // 7. SQL firewall check (advisory — warn but don't block)
  let firewallWarning: string | undefined;
  try {
    const firewallResult = await sqlFirewall.evaluateQuery(tenantId, result.sql);
    if (!firewallResult.allowed) {
      firewallWarning = firewallResult.matchedRule
        ? `Firewall would block: ${firewallResult.matchedRule.name}`
        : 'SQL firewall would block this query';
    } else if (firewallResult.matchedRule && firewallResult.action !== 'BLOCK') {
      firewallWarning = `Firewall alert: ${firewallResult.matchedRule.name}`;
    }
  } catch {
    // Firewall check is best-effort
  }

  // 8. Audit log (truncate prompt to 200 chars)
  auditService.log({
    userId,
    action: 'AI_QUERY_GENERATED',
    targetType: 'DatabaseQuery',
    targetId: tenantId,
    details: {
      prompt: prompt.slice(0, 200),
      generatedSql: result.sql,
      provider,
      model,
      tenantId,
      firewallWarning: firewallWarning ?? undefined,
    },
    ipAddress,
  });

  return {
    sql: result.sql,
    explanation: result.explanation,
    firewallWarning,
  };
}
