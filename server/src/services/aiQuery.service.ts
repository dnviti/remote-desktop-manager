import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/error.middleware';
import * as auditService from './audit.service';
import * as tenantAiConfigService from './tenantAiConfig.service';
import * as sqlFirewall from './sqlFirewall.service';
import * as llm from './llm.service';
import type { TableInfo } from './dbSession.service';
import type { IntrospectionType } from './dbIntrospection.service';
import type { LlmMessage, LlmOverrides } from './llm.service';

const log = logger.child('aiQuery');

// ===========================================================================
// AI Query Generation (AISQL-2069)
// ===========================================================================

// ---------------------------------------------------------------------------
// Per-tenant daily request counters (resets at midnight UTC)
// NOTE: In-memory — resets on server restart and is not shared across instances.
// For production multi-instance deployments, use a shared store (Redis/DB).
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
// System prompt for query generation
// ---------------------------------------------------------------------------
function buildGenerationSystemPrompt(dbProtocol: string): string {
  const dialect = dbProtocol.toUpperCase();
  return `You are a SQL query assistant. You generate SQL queries from natural language descriptions.

CRITICAL CONSTRAINT:
You may ONLY reference tables that appear in the schema below. The user has explicitly approved only these tables. You MUST NOT reference, join, subquery, or otherwise use ANY table not listed in the schema. If the approved tables are insufficient to fully answer the request, write the best query you can using ONLY the approved tables and explain the limitation.

RULES:
1. ONLY generate SELECT queries. NEVER generate INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE, or any DML/DDL statements.
2. Use the correct SQL dialect for ${dialect}.
3. ONLY use table and column names from the provided schema — do not reference any other tables.
4. If the request is ambiguous, make reasonable assumptions and explain them.
5. When the user does not specify a limit, add a reasonable limit on the number of returned rows. Use the appropriate limiting syntax for the ${dialect} dialect (for example, LIMIT for PostgreSQL/MySQL, TOP for MSSQL, FETCH FIRST for DB2/Oracle).
6. Use table aliases for readability.
7. Return your response as a JSON object with two fields:
   - "sql": the generated SELECT query (using ONLY approved tables)
   - "explanation": a brief explanation of what the query does and any assumptions made

Example response:
{"sql": "SELECT o.id, o.total FROM orders o WHERE o.total > 1000", "explanation": "Retrieves orders where the total is greater than 1000."}`;
}

// ---------------------------------------------------------------------------
// Response parsing for query generation
// ---------------------------------------------------------------------------
function parseGenerationResponse(raw: string): { sql: string; explanation: string } {
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

  return { sql, explanation: afterBlock || '' };
}

// ---------------------------------------------------------------------------
// Table reference enforcement
// ---------------------------------------------------------------------------
/**
 * Checks if the SQL references any table from the full schema that is NOT in
 * the approved (filtered) schema. Returns the first violating table name or null.
 */
function findUnapprovedTableReference(
  sql: string,
  approvedTables: TableInfo[],
  allTables: TableInfo[],
): string | null {
  const approvedNames = new Set<string>();
  for (const t of approvedTables) {
    approvedNames.add(t.name.toLowerCase());
    approvedNames.add(`${t.schema}.${t.name}`.toLowerCase());
  }

  const sqlLower = sql.toLowerCase();

  for (const t of allTables) {
    const unqualified = t.name.toLowerCase();
    const qualified = `${t.schema}.${t.name}`.toLowerCase();

    // Skip if this table is approved
    if (approvedNames.has(unqualified) || approvedNames.has(qualified)) continue;

    // Check if the unapproved table name appears as a word in the SQL
    // Use word boundary matching to avoid false positives (e.g., "orders" matching "order_items")
    const pattern = new RegExp(`\\b${escapeRegex(unqualified)}\\b`, 'i');
    if (pattern.test(sqlLower)) {
      return t.schema !== 'public' ? `${t.schema}.${t.name}` : t.name;
    }
    // Also check qualified form
    const qualifiedPattern = new RegExp(`\\b${escapeRegex(qualified)}\\b`, 'i');
    if (qualifiedPattern.test(sqlLower)) {
      return `${t.schema}.${t.name}`;
    }
  }

  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Generation conversation store (in-memory, TTL-managed)
// ---------------------------------------------------------------------------
export interface ObjectRequest {
  name: string;
  schema: string;
  reason: string;
}

interface GenerationConversation {
  id: string;
  userId: string;
  tenantId: string;
  prompt: string;
  dbProtocol: string;
  fullSchema: TableInfo[];
  overrides?: LlmOverrides;
  ipAddress?: string;
  createdAt: Date;
}

const generationConversations = new Map<string, GenerationConversation>();

const GENERATION_TTL_MS = 10 * 60 * 1000; // 10 minutes

setInterval(() => {
  const cutoff = Date.now() - GENERATION_TTL_MS;
  for (const [id, conv] of generationConversations) {
    if (conv.createdAt.getTime() < cutoff) generationConversations.delete(id);
  }
}, 60_000);

// ---------------------------------------------------------------------------
// Planning system prompt (step 1: which tables are needed)
// ---------------------------------------------------------------------------
function buildPlanningSystemPrompt(): string {
  return `You are a SQL query planning assistant. Given a user's request and a list of available database tables, determine which tables are needed to write the query.

Return ONLY valid JSON with no markdown fences:
{"tables": [{"name": "table_name", "schema": "schema_name", "reason": "brief reason this table is needed"}]}

Rules:
- Only include tables that are genuinely needed to answer the user's request.
- Do not invent tables that are not in the provided list.
- Include join tables if a relationship requires them.
- Keep reasons concise (one sentence).`;
}

function formatTableList(tables: TableInfo[]): string {
  if (!tables.length) return 'No tables available.';
  const lines: string[] = ['Available tables:'];
  for (const t of tables.slice(0, 100)) {
    const qualified = t.schema && t.schema !== 'public' ? `${t.schema}.${t.name}` : t.name;
    const colNames = t.columns.map((c) => c.name).join(', ');
    lines.push(`- ${qualified} (${colNames})`);
  }
  return lines.join('\n');
}

function parsePlanningResponse(raw: string): ObjectRequest[] {
  const jsonMatch = raw.match(/\{[\s\S]*"tables"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { tables?: Array<{ name?: string; schema?: string; reason?: string }> };
      if (Array.isArray(parsed.tables)) {
        return parsed.tables
          .filter((t) => t.name)
          .map((t) => ({ name: t.name!, schema: t.schema || 'public', reason: t.reason || '' }));
      }
    } catch {
      // Fall through
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface AnalyzeParams {
  tenantId: string;
  userId: string;
  prompt: string;
  schema: TableInfo[];
  dbProtocol: string;
  ipAddress?: string;
}

export interface AnalyzeResult {
  status: 'pending_approval';
  conversationId: string;
  objectRequests: ObjectRequest[];
}

export interface GenerateResult {
  status: 'complete';
  sql: string;
  explanation: string;
  firewallWarning?: string;
}

// ---------------------------------------------------------------------------
// Step 1: Analyze query intent (returns needed tables for approval)
// ---------------------------------------------------------------------------
export async function analyzeQueryIntent(params: AnalyzeParams): Promise<AnalyzeResult> {
  const { tenantId, userId, prompt, schema, dbProtocol, ipAddress } = params;

  // 1. Get tenant AI configuration
  const tenantCfg = await tenantAiConfigService.getFullConfig(tenantId);

  // 2. Check if feature is enabled
  if (!config.ai.queryGenerationEnabled && !tenantCfg?.enabled) {
    throw new AppError('AI query generation is not enabled', 403);
  }

  // 3. Build LLM overrides
  const queryModel = config.ai.queryGenerationModel || undefined;
  const dailyLimit = tenantCfg?.dailyRequestLimit ?? config.ai.maxRequestsPerDay;

  let overrides: LlmOverrides | undefined;
  if (tenantCfg && tenantCfg.provider !== 'none' && tenantCfg.apiKey) {
    overrides = {
      provider: tenantCfg.provider,
      apiKey: tenantCfg.apiKey,
      model: tenantCfg.modelId || queryModel,
      baseUrl: tenantCfg.baseUrl || undefined,
      maxTokens: tenantCfg.maxTokensPerRequest,
    };
  } else if (queryModel) {
    overrides = { model: queryModel };
  }

  // 4. Rate-limit check
  incrementDailyCounter(tenantId, dailyLimit);

  // 5. Ask LLM which tables are needed
  const systemPrompt = buildPlanningSystemPrompt();
  const tableList = formatTableList(schema);
  const userPrompt = `${tableList}\n\nUser request: ${prompt}`;

  let objectRequests: ObjectRequest[];
  try {
    const llmResult = await llm.complete({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }, overrides);
    objectRequests = parsePlanningResponse(llmResult.content);
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error(`AI query planning failed: ${message}`);
    throw new AppError(`AI query planning failed: ${message}`, 502);
  }

  // Filter to only tables that actually exist in the schema
  const schemaLookup = new Set(schema.map((t) => `${t.schema}.${t.name}`));
  objectRequests = objectRequests.filter((r) => schemaLookup.has(`${r.schema}.${r.name}`));

  if (objectRequests.length === 0) {
    throw new AppError('The AI could not identify any relevant tables for your request. Try rephrasing.', 400);
  }

  // 6. Store conversation
  const conversationId = uuidv4();
  generationConversations.set(conversationId, {
    id: conversationId,
    userId,
    tenantId,
    prompt,
    dbProtocol,
    fullSchema: schema,
    overrides,
    ipAddress,
    createdAt: new Date(),
  });

  log.info(`AI query analysis started: conversation ${conversationId}, ${objectRequests.length} tables requested`);

  return { status: 'pending_approval', conversationId, objectRequests };
}

// ---------------------------------------------------------------------------
// Step 2: Generate SQL with approved tables only
// ---------------------------------------------------------------------------
export async function confirmAndGenerate(
  conversationId: string,
  approvedObjects: string[],
  userId: string,
  tenantId: string,
  ipAddress?: string,
): Promise<GenerateResult> {
  const conv = generationConversations.get(conversationId);
  if (!conv) {
    throw new AppError('Conversation expired or not found. Please start a new query.', 404);
  }

  if (conv.userId !== userId || conv.tenantId !== tenantId) {
    throw new AppError('Unauthorized', 403);
  }

  // Clean up the conversation
  generationConversations.delete(conversationId);

  // Filter schema to only approved tables
  const approvedSet = new Set(approvedObjects);
  const filteredSchema = conv.fullSchema.filter((t) => {
    const qualified = `${t.schema}.${t.name}`;
    const unqualified = t.name;
    return approvedSet.has(qualified) || approvedSet.has(unqualified);
  });

  if (filteredSchema.length === 0) {
    throw new AppError('No tables were approved. Cannot generate a query.', 400);
  }

  // Build prompts with filtered schema only
  const systemPrompt = buildGenerationSystemPrompt(conv.dbProtocol);
  const schemaContext = formatSchemaContext(filteredSchema, conv.dbProtocol);
  const userPrompt = `${schemaContext}\n\nUser request: ${conv.prompt}`;

  const provider = conv.overrides?.provider || config.ai.provider || 'none';
  const model = conv.overrides?.model || config.ai.model || '';

  let result: { sql: string; explanation: string };
  try {
    const llmResult = await llm.complete({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }, conv.overrides);

    result = parseGenerationResponse(llmResult.content);
  } catch (err) {
    if (err instanceof AppError) throw err;
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error(`AI query generation failed: ${message}`);
    throw new AppError(`AI query generation failed: ${message}`, 502);
  }

  // Validate SELECT-only
  const normalizedSql = result.sql.replace(/^\s*--.*/gm, '').trim();
  const firstWord = normalizedSql.split(/\s+/)[0]?.toUpperCase();
  if (firstWord !== 'SELECT' && firstWord !== 'WITH' && firstWord !== '(') {
    log.warn(`AI generated non-SELECT query, blocking: first word was "${firstWord}"`);
    throw new AppError('The AI generated a non-SELECT query. Only SELECT queries are allowed.', 400);
  }

  // Enforce approved tables — reject SQL that references unapproved tables
  const violation = findUnapprovedTableReference(result.sql, filteredSchema, conv.fullSchema);
  if (violation) {
    log.warn(`AI referenced unapproved table "${violation}", regenerating with stricter constraint`);
    // Retry once with an explicit denial list
    const deniedTables = conv.fullSchema
      .filter((t) => !filteredSchema.some((f) => f.name === t.name && f.schema === t.schema))
      .map((t) => t.schema !== 'public' ? `${t.schema}.${t.name}` : t.name);
    const stricterPrompt = `${schemaContext}\n\nIMPORTANT: You MUST NOT reference these denied tables: ${deniedTables.join(', ')}\n\nUser request: ${conv.prompt}`;
    try {
      const retryResult = await llm.complete({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: stricterPrompt },
        ],
      }, conv.overrides);
      result = parseGenerationResponse(retryResult.content);
      // Check again
      const retryViolation = findUnapprovedTableReference(result.sql, filteredSchema, conv.fullSchema);
      if (retryViolation) {
        throw new AppError(
          `The AI used unapproved table "${retryViolation}". Only these tables were approved: ${approvedObjects.join(', ')}. Try approving more tables or rephrasing your request.`,
          400,
        );
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(
        `The AI used unapproved table "${violation}". Only these tables were approved: ${approvedObjects.join(', ')}. Try approving more tables or rephrasing your request.`,
        400,
      );
    }
  }

  // SQL firewall check (advisory)
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

  // Audit log
  auditService.log({
    userId,
    action: 'AI_QUERY_GENERATED',
    targetType: 'DatabaseQuery',
    targetId: tenantId,
    details: {
      prompt: conv.prompt.slice(0, 200),
      generatedSql: result.sql,
      approvedTables: approvedObjects,
      provider,
      model,
      tenantId,
      firewallWarning: firewallWarning ?? undefined,
    },
    ipAddress,
  });

  return {
    status: 'complete',
    sql: result.sql,
    explanation: result.explanation,
    firewallWarning,
  };
}

// ===========================================================================
// AI Query Optimization (SQLVIZ-2070)
// ===========================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DataRequest {
  type: IntrospectionType | 'custom_query';
  target: string;
  reason: string;
}

export interface OptimizeQueryInput {
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

interface ConversationState {
  id: string;
  userId: string;
  tenantId: string;
  input: OptimizeQueryInput;
  rounds: number;
  approvedData: Record<string, unknown>;
  llmMessages: LlmMessage[];
  createdAt: Date;
}

// In-memory conversation store (TTL managed by cleanup).
// NOTE: This does not survive server restarts or scale across multiple instances.
// For production multi-instance deployments, consider a shared store (Redis/DB).
const conversations = new Map<string, ConversationState>();

// ---------------------------------------------------------------------------
// System prompt for optimization
// ---------------------------------------------------------------------------

const OPTIMIZATION_SYSTEM_PROMPT = `You are an expert SQL performance analyst and query optimizer.
Your task is to analyze SQL queries and their execution plans, then produce optimized versions.

You work in a multi-turn flow:
1. FIRST TURN: You receive a SQL query and execution plan. Analyze them and request specific database metadata you need (indexes, statistics, foreign keys). Respond ONLY with a JSON object.
2. SECOND TURN: You receive the requested metadata. Produce the optimized query with explanation. Respond ONLY with a JSON object.

FIRST TURN response format (when you need additional data):
{
  "needs_data": true,
  "data_requests": [
    { "type": "indexes|statistics|foreign_keys", "target": "table_name", "reason": "brief reason" }
  ]
}

FIRST TURN response format (when you can optimize immediately):
{
  "needs_data": false,
  "optimized_sql": "SELECT ...",
  "explanation": "Explanation of changes...",
  "changes": ["change 1", "change 2"]
}

SECOND TURN response format:
{
  "optimized_sql": "SELECT ...",
  "explanation": "Explanation of changes...",
  "changes": ["change 1", "change 2"]
}

Rules:
- Only suggest changes you are confident will improve performance.
- If the query is already optimal, set optimized_sql to the original query and explain why.
- Never suggest changes that alter query semantics (same results, same ordering).
- Consider the specific database engine and version provided.
- Be specific in your explanations (mention index names, cardinality, join strategies).
- Respond ONLY with valid JSON, no markdown fences or extra text.`;

// Valid introspection types for validation
const VALID_INTROSPECTION_TYPES = new Set<string>([
  'indexes', 'statistics', 'foreign_keys', 'table_schema', 'row_count',
]);

// ---------------------------------------------------------------------------
// AI Optimization — initial analysis
// ---------------------------------------------------------------------------

export async function optimizeQuery(
  input: OptimizeQueryInput,
  userId: string,
  tenantId: string,
  ipAddress?: string,
): Promise<OptimizeQueryResult> {
  if (!llm.isConfigured()) {
    throw new AppError(
      'AI query optimization is not available. An administrator must configure an AI/LLM provider in Settings.',
      503,
    );
  }

  const conversationId = uuidv4();

  const userMessage = buildFirstTurnMessage(input);
  const messages: LlmMessage[] = [
    { role: 'system', content: OPTIMIZATION_SYSTEM_PROMPT },
    { role: 'user', content: userMessage },
  ];

  let parsed: FirstTurnResponse;
  try {
    const result = await llm.complete({ messages });
    parsed = parseFirstTurnResponse(result.content);
  } catch (err) {
    if (err instanceof AppError) throw err;
    // Fallback to heuristic table extraction if LLM fails
    log.error('LLM first-turn call failed, falling back to heuristic analysis');
    parsed = buildHeuristicDataRequests(input.sql);
  }

  // Store conversation for multi-turn
  conversations.set(conversationId, {
    id: conversationId,
    userId,
    tenantId,
    input,
    rounds: 0,
    approvedData: {},
    llmMessages: messages,
    createdAt: new Date(),
  });

  auditService.log({
    userId,
    action: 'DB_QUERY_AI_OPTIMIZED',
    targetType: 'DatabaseQuery',
    targetId: input.sessionId,
    details: {
      conversationId,
      phase: 'initial',
      provider: llm.getProviderName(),
      dataRequestCount: parsed.data_requests?.length ?? 0,
      dataRequestTypes: parsed.data_requests?.map((r) => `${r.type}:${r.target}`) ?? [],
    },
    ipAddress,
  });

  log.info(`AI optimization started: conversation ${conversationId}`);

  if (!parsed.needs_data) {
    conversations.delete(conversationId);
    return {
      status: 'complete',
      conversationId,
      optimizedSql: parsed.optimized_sql || input.sql,
      explanation: parsed.explanation || 'No optimization opportunities identified.',
      changes: parsed.changes || [],
    };
  }

  return {
    status: 'needs_data',
    conversationId,
    dataRequests: parsed.data_requests,
  };
}

// ---------------------------------------------------------------------------
// AI Optimization — continue with approved data
// ---------------------------------------------------------------------------

export async function continueOptimization(
  conversationId: string,
  approvedData: Record<string, unknown>,
  userId: string,
  tenantId: string,
  ipAddress?: string,
): Promise<OptimizeQueryResult> {
  const convo = conversations.get(conversationId);
  if (!convo) {
    throw new AppError('Conversation not found or expired.', 404);
  }

  // Prevent one user from continuing another user's conversation
  if (convo.userId !== userId || convo.tenantId !== tenantId) {
    throw new AppError('Conversation not found or expired.', 404);
  }

  convo.rounds += 1;
  Object.assign(convo.approvedData, approvedData);

  // Build the second-turn message with the introspection data
  const userMessage = buildSecondTurnMessage(approvedData);

  // Reconstruct messages: keep the system + first user, add assistant placeholder + second user
  const messages: LlmMessage[] = [
    ...convo.llmMessages,
    { role: 'assistant', content: '{"needs_data": true, "data_requests": [...]}' },
    { role: 'user', content: userMessage },
  ];

  let parsed: SecondTurnResponse;
  try {
    const result = await llm.complete({ messages });
    parsed = parseSecondTurnResponse(result.content, convo.input.sql);
  } catch (err) {
    if (err instanceof AppError) throw err;
    log.error('LLM second-turn call failed');
    parsed = {
      optimized_sql: convo.input.sql,
      explanation: 'AI analysis could not be completed. The original query is returned unchanged.',
      changes: [],
    };
  }

  auditService.log({
    userId,
    action: 'DB_QUERY_AI_OPTIMIZED',
    targetType: 'DatabaseQuery',
    targetId: convo.input.sessionId,
    details: {
      conversationId,
      phase: 'continue',
      round: convo.rounds,
      provider: llm.getProviderName(),
      approvedDataKeys: Object.keys(approvedData),
    },
    ipAddress,
  });

  // Clean up conversation
  conversations.delete(conversationId);

  return {
    status: 'complete',
    conversationId,
    optimizedSql: parsed.optimized_sql,
    explanation: parsed.explanation,
    changes: parsed.changes,
  };
}

// ---------------------------------------------------------------------------
// Message builders
// ---------------------------------------------------------------------------

function buildFirstTurnMessage(input: OptimizeQueryInput): string {
  const parts = [`Database: ${input.dbProtocol}${input.dbVersion ? ` ${input.dbVersion}` : ''}`];

  parts.push(`\nSQL Query:\n${input.sql}`);

  if (input.executionPlan) {
    const planStr = typeof input.executionPlan === 'string'
      ? input.executionPlan
      : JSON.stringify(input.executionPlan, null, 2);
    // Truncate very large execution plans to avoid token limits
    const truncated = planStr.length > 50_000
      ? planStr.slice(0, 50_000) + '\n[truncated]'
      : planStr;
    parts.push(`\nExecution Plan:\n${truncated}`);
  }

  if (input.schemaContext) {
    const schemaStr = typeof input.schemaContext === 'string'
      ? input.schemaContext
      : JSON.stringify(input.schemaContext, null, 2);
    parts.push(`\nSchema Context:\n${schemaStr}`);
  }

  return parts.join('\n');
}

function buildSecondTurnMessage(approvedData: Record<string, unknown>): string {
  return `Here is the database metadata you requested:\n\n${JSON.stringify(approvedData, null, 2)}\n\nBased on this data, produce the optimized query.`;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

interface FirstTurnResponse {
  needs_data: boolean;
  data_requests?: DataRequest[];
  optimized_sql?: string;
  explanation?: string;
  changes?: string[];
}

interface SecondTurnResponse {
  optimized_sql: string;
  explanation: string;
  changes: string[];
}

function extractJson(text: string): unknown {
  // Try direct parse
  try {
    return JSON.parse(text);
  } catch { /* continue */ }

  // Try extracting from markdown code fence
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) {
    try {
      return JSON.parse(match[1].trim());
    } catch { /* continue */ }
  }

  // Try finding a JSON object in the text
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0]);
    } catch { /* continue */ }
  }

  throw new AppError('AI returned an invalid response format.', 502);
}

function parseFirstTurnResponse(content: string): FirstTurnResponse {
  const raw = extractJson(content) as Record<string, unknown>;

  if (raw.needs_data === true && Array.isArray(raw.data_requests)) {
    // Validate and filter data requests
    const validRequests: DataRequest[] = [];
    for (const req of raw.data_requests) {
      if (
        req && typeof req === 'object' &&
        'type' in req && typeof req.type === 'string' &&
        'target' in req && typeof req.target === 'string' &&
        'reason' in req && typeof req.reason === 'string' &&
        VALID_INTROSPECTION_TYPES.has(req.type)
      ) {
        validRequests.push({
          type: req.type as IntrospectionType,
          target: req.target,
          reason: req.reason,
        });
      }
    }

    if (validRequests.length > 0) {
      return { needs_data: true, data_requests: validRequests };
    }
  }

  // Either needs_data is false or no valid requests — treat as complete
  return {
    needs_data: false,
    optimized_sql: typeof raw.optimized_sql === 'string' ? raw.optimized_sql : undefined,
    explanation: typeof raw.explanation === 'string' ? raw.explanation : undefined,
    changes: Array.isArray(raw.changes) ? raw.changes.filter((c): c is string => typeof c === 'string') : undefined,
  };
}

function parseSecondTurnResponse(content: string, originalSql: string): SecondTurnResponse {
  const raw = extractJson(content) as Record<string, unknown>;

  return {
    optimized_sql: typeof raw.optimized_sql === 'string' ? raw.optimized_sql : originalSql,
    explanation: typeof raw.explanation === 'string'
      ? raw.explanation
      : 'Analysis complete. The query appears to be reasonably optimized.',
    changes: Array.isArray(raw.changes)
      ? raw.changes.filter((c): c is string => typeof c === 'string')
      : [],
  };
}

// ---------------------------------------------------------------------------
// Heuristic fallback (used when LLM is unavailable during first turn)
// ---------------------------------------------------------------------------

function buildHeuristicDataRequests(sql: string): FirstTurnResponse {
  const tables = extractTablesFromSql(sql);
  const dataRequests: DataRequest[] = [];

  for (const table of tables.slice(0, 5)) {
    dataRequests.push({
      type: 'indexes',
      target: table,
      reason: `Inspect indexes on \`${table}\` to identify missing index opportunities`,
    });
    dataRequests.push({
      type: 'statistics',
      target: table,
      reason: `Read column statistics for \`${table}\` to understand data distribution`,
    });
  }

  if (tables.length > 1) {
    for (const table of tables.slice(0, 3)) {
      dataRequests.push({
        type: 'foreign_keys',
        target: table,
        reason: `Check foreign key relationships on \`${table}\` for join optimization`,
      });
    }
  }

  return {
    needs_data: dataRequests.length > 0,
    data_requests: dataRequests.length > 0 ? dataRequests : undefined,
  };
}

function extractTablesFromSql(sql: string): string[] {
  const tables: string[] = [];
  const fromJoinRegex = /(?:FROM|JOIN)\s+(?:`|"|')?(\w+)(?:`|"|')?/gi;
  let match: RegExpExecArray | null;
  while ((match = fromJoinRegex.exec(sql)) !== null) {
    const name = match[1];
    if (name && !tables.includes(name)) {
      tables.push(name);
    }
  }
  return tables;
}

// Cleanup stale conversations (older than 30 minutes)
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, convo] of conversations) {
    if (convo.createdAt.getTime() < cutoff) {
      conversations.delete(id);
    }
  }
}, 5 * 60 * 1000);
