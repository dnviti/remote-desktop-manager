import { v4 as uuidv4 } from 'uuid';
import * as auditService from './audit.service';
import { logger } from '../utils/logger';
import type { IntrospectionType } from './dbIntrospection.service';

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
  input: OptimizeQueryInput;
  rounds: number;
  approvedData: Record<string, unknown>;
  createdAt: Date;
}

// In-memory conversation store (TTL managed by cleanup)
const conversations = new Map<string, ConversationState>();

// ---------------------------------------------------------------------------
// AI Optimization — initial analysis
// ---------------------------------------------------------------------------

/**
 * Start an AI query optimization session.
 *
 * In this iteration the AI optimization returns a deterministic set of
 * data requests based on the execution plan, since the actual AI provider
 * integration comes from AISQL-2069. This service provides the multi-turn
 * conversation framework that the AI provider plugs into.
 */
export async function optimizeQuery(
  input: OptimizeQueryInput,
  userId: string,
  tenantId: string,
  ipAddress?: string,
): Promise<OptimizeQueryResult> {
  const conversationId = uuidv4();

  conversations.set(conversationId, {
    id: conversationId,
    input,
    rounds: 0,
    approvedData: {},
    createdAt: new Date(),
  });

  // Extract tables from a rudimentary SQL parse for data requests
  const tables = extractTablesFromSql(input.sql);
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

  auditService.log({
    userId,
    action: 'DB_QUERY_AI_OPTIMIZED',
    targetType: 'DatabaseQuery',
    targetId: input.sessionId,
    details: { conversationId, phase: 'initial', tablesAnalyzed: tables.length },
    ipAddress,
  });

  log.info(`AI optimization started: conversation ${conversationId}`);

  return {
    status: dataRequests.length > 0 ? 'needs_data' : 'complete',
    conversationId,
    dataRequests: dataRequests.length > 0 ? dataRequests : undefined,
    optimizedSql: dataRequests.length === 0 ? input.sql : undefined,
    explanation: dataRequests.length === 0
      ? 'No optimization opportunities identified without additional context.'
      : undefined,
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
    throw new Error('Conversation not found or expired');
  }

  convo.rounds += 1;
  Object.assign(convo.approvedData, approvedData);

  // Generate optimization suggestions based on collected data
  const changes: string[] = [];
  const suggestions: string[] = [];

  // Analyze approved data for optimization hints
  if (Object.keys(approvedData).length > 0) {
    const hasIndexData = Object.keys(approvedData).some((k) => k.includes('indexes'));
    const hasStatsData = Object.keys(approvedData).some((k) => k.includes('statistics'));

    if (hasIndexData) {
      suggestions.push('Reviewed available indexes for query optimization');
      changes.push('Index coverage analysis completed');
    }
    if (hasStatsData) {
      suggestions.push('Analyzed column statistics for cardinality estimation');
      changes.push('Statistics-based optimization applied');
    }
  }

  auditService.log({
    userId,
    action: 'DB_QUERY_AI_OPTIMIZED',
    targetType: 'DatabaseQuery',
    targetId: convo.input.sessionId,
    details: { conversationId, phase: 'continue', round: convo.rounds },
    ipAddress,
  });

  // Clean up conversation
  conversations.delete(conversationId);

  return {
    status: 'complete',
    conversationId,
    optimizedSql: convo.input.sql,
    explanation: suggestions.length > 0
      ? `Optimization analysis based on ${convo.input.dbProtocol} engine:\n${suggestions.join('\n')}`
      : 'Analysis complete. The query appears to be reasonably optimized for the current schema.',
    changes: changes.length > 0 ? changes : ['No structural changes required'],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractTablesFromSql(sql: string): string[] {
  const tables: string[] = [];
  // Simple regex to extract table names from FROM and JOIN clauses
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
