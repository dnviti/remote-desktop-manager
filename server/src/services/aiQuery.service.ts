import { v4 as uuidv4 } from 'uuid';
import * as auditService from './audit.service';
import * as llm from './llm.service';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/error.middleware';
import type { IntrospectionType } from './dbIntrospection.service';
import type { LlmMessage } from './llm.service';

const log = logger.child('ai-query');

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
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an expert SQL performance analyst and query optimizer.
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
    { role: 'system', content: SYSTEM_PROMPT },
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
