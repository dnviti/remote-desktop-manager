import prisma, { DbQueryType, Prisma } from '../lib/prisma';
import { logger } from '../utils/logger';

const log = logger.child('db-audit');

// ---- Types ----

export interface DbAuditLogInput {
  userId: string;
  connectionId: string;
  tenantId?: string;
  queryText: string;
  queryType: DbQueryType;
  tablesAccessed?: string[];
  rowsAffected?: number;
  executionTimeMs?: number;
  blocked?: boolean;
  blockReason?: string;
  executionPlan?: unknown;
}

export interface DbAuditLogEntry {
  id: string;
  userId: string;
  connectionId: string;
  tenantId: string | null;
  queryText: string;
  queryType: DbQueryType;
  tablesAccessed: string[];
  rowsAffected: number | null;
  executionTimeMs: number | null;
  blocked: boolean;
  blockReason: string | null;
  executionPlan: unknown | null;
  createdAt: Date;
}

export interface DbAuditLogQuery {
  tenantId: string;
  userId?: string;
  connectionId?: string;
  queryType?: DbQueryType;
  blocked?: boolean;
  search?: string;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'queryType' | 'executionTimeMs';
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedDbAuditLogs {
  data: (DbAuditLogEntry & { userName: string | null; userEmail: string | null; connectionName: string | null })[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ---- Query classification ----

const DDL_KEYWORDS = /^\s*(CREATE|ALTER|DROP|TRUNCATE|RENAME|COMMENT)\b/i;
const SELECT_KEYWORDS = /^\s*SELECT\b/i;
const INSERT_KEYWORDS = /^\s*INSERT\b/i;
const UPDATE_KEYWORDS = /^\s*UPDATE\b/i;
const DELETE_KEYWORDS = /^\s*DELETE\b/i;

/**
 * Strip leading SQL comments (line `--` and block comments) and whitespace.
 * Uses a character-scanning loop instead of regex to avoid polynomial
 * backtracking (CodeQL js/polynomial-redos).
 */
function stripLeadingComments(sql: string): string {
  let i = 0;
  const len = sql.length;

  while (i < len) {
    // Skip whitespace
    const ch = sql.charCodeAt(i);
    if (ch === 32 || ch === 9 || ch === 10 || ch === 13) { // space, tab, LF, CR
      i++;
      continue;
    }

    // Line comment: -- ... \n
    if (i + 1 < len && sql[i] === '-' && sql[i + 1] === '-') {
      i += 2;
      while (i < len && sql[i] !== '\n') i++;
      if (i < len) i++; // skip newline
      continue;
    }

    // Block comment: /* ... */
    if (i + 1 < len && sql[i] === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i + 1 < len && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      if (i + 1 < len) i += 2; // skip */
      continue;
    }

    break;
  }

  return sql.slice(i);
}

/**
 * Classify a SQL query text into a DbQueryType.
 * Handles CTEs (WITH ... SELECT/INSERT/UPDATE/DELETE), EXPLAIN, SHOW, etc.
 */
export function classifyQuery(queryText: string): DbQueryType {
  const trimmed = stripLeadingComments(queryText);

  if (DDL_KEYWORDS.test(trimmed)) return 'DDL';
  if (SELECT_KEYWORDS.test(trimmed)) return 'SELECT';
  if (INSERT_KEYWORDS.test(trimmed)) return 'INSERT';
  if (UPDATE_KEYWORDS.test(trimmed)) return 'UPDATE';
  if (DELETE_KEYWORDS.test(trimmed)) return 'DELETE';

  // CTE: WITH name AS (...) SELECT/INSERT/UPDATE/DELETE
  if (/^\s*WITH\b/i.test(trimmed)) {
    // Look for the final statement after the CTE definitions
    if (/\)\s*SELECT\b/i.test(trimmed)) return 'SELECT';
    if (/\)\s*INSERT\b/i.test(trimmed)) return 'INSERT';
    if (/\)\s*UPDATE\b/i.test(trimmed)) return 'UPDATE';
    if (/\)\s*DELETE\b/i.test(trimmed)) return 'DELETE';
    return 'SELECT'; // CTEs are overwhelmingly SELECT
  }

  // EXPLAIN/DESCRIBE wraps another statement
  if (/^\s*(EXPLAIN|DESCRIBE|DESC)\b/i.test(trimmed)) return 'SELECT';
  // SHOW (SHOW TABLES, SHOW COLUMNS, etc.)
  if (/^\s*SHOW\b/i.test(trimmed)) return 'SELECT';
  // SET is DDL-like
  if (/^\s*SET\b/i.test(trimmed)) return 'DDL';
  // GRANT/REVOKE
  if (/^\s*(GRANT|REVOKE)\b/i.test(trimmed)) return 'DDL';
  // MERGE (upsert)
  if (/^\s*MERGE\b/i.test(trimmed)) return 'UPDATE';
  // CALL / EXEC (stored procedures)
  if (/^\s*(CALL|EXEC|EXECUTE)\b/i.test(trimmed)) return 'OTHER';

  return 'OTHER';
}

/**
 * Extract table names from a SQL query (best effort, covers common patterns).
 */
export function extractTables(queryText: string): string[] {
  const tables = new Set<string>();
  /* eslint-disable security/detect-unsafe-regex -- These SQL keyword patterns are bounded (word-boundary anchored,
     no nested quantifiers, no overlapping alternations) and operate on length-limited query text. */
  const patterns = [
    /\bFROM\s+(["`]?\w+["`]?(?:\s*\.\s*["`]?\w+["`]?)?)/gi,
    /\bJOIN\s+(["`]?\w+["`]?(?:\s*\.\s*["`]?\w+["`]?)?)/gi,
    /\bINTO\s+(["`]?\w+["`]?(?:\s*\.\s*["`]?\w+["`]?)?)/gi,
    /\bUPDATE\s+(["`]?\w+["`]?(?:\s*\.\s*["`]?\w+["`]?)?)/gi,
    /\bTABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(["`]?\w+["`]?(?:\s*\.\s*["`]?\w+["`]?)?)/gi,
    /\bTRUNCATE\s+(?:TABLE\s+)?(["`]?\w+["`]?(?:\s*\.\s*["`]?\w+["`]?)?)/gi,
  ];
  /* eslint-enable security/detect-unsafe-regex */

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(queryText)) !== null) {
      const tableName = match[1].replace(/["`]/g, '').trim();
      if (tableName && !isReservedKeyword(tableName)) {
        tables.add(tableName.toLowerCase());
      }
    }
  }
  return Array.from(tables);
}

const RESERVED = new Set([
  'select', 'set', 'values', 'where', 'group', 'order', 'having',
  'limit', 'offset', 'union', 'except', 'intersect', 'case', 'when',
  'then', 'else', 'end', 'as', 'on', 'and', 'or', 'not', 'in',
  'exists', 'between', 'like', 'is', 'null', 'true', 'false',
  'dual', 'information_schema',
]);

function isReservedKeyword(word: string): boolean {
  return RESERVED.has(word.toLowerCase());
}

// ---- Audit log writer ----

/**
 * Fire-and-forget DB audit log writer. Never throws.
 */
export function logQuery(input: DbAuditLogInput): void {
  prisma.dbAuditLog
    .create({
      data: {
        userId: input.userId,
        connectionId: input.connectionId,
        tenantId: input.tenantId ?? null,
        queryText: input.queryText,
        queryType: input.queryType,
        tablesAccessed: input.tablesAccessed ?? [],
        rowsAffected: input.rowsAffected ?? null,
        executionTimeMs: input.executionTimeMs ?? null,
        blocked: input.blocked ?? false,
        blockReason: input.blockReason ?? null,
        executionPlan: input.executionPlan ?? Prisma.DbNull,
      },
    })
    .catch((err) => {
      log.error('Failed to write DB audit log:', err instanceof Error ? err.message : 'Unknown error');
    });
}

/**
 * Intercept and audit a SQL statement. Classifies the query, extracts tables,
 * and writes to the DB audit log.
 */
export function interceptQuery(params: {
  userId: string;
  connectionId: string;
  tenantId?: string;
  queryText: string;
  rowsAffected?: number;
  executionTimeMs?: number;
  blocked?: boolean;
  blockReason?: string;
  executionPlan?: unknown;
}): void {
  const queryType = classifyQuery(params.queryText);
  const tablesAccessed = extractTables(params.queryText);

  logQuery({
    userId: params.userId,
    connectionId: params.connectionId,
    tenantId: params.tenantId,
    queryText: params.queryText,
    queryType,
    tablesAccessed,
    rowsAffected: params.rowsAffected,
    executionTimeMs: params.executionTimeMs,
    blocked: params.blocked,
    blockReason: params.blockReason,
    executionPlan: params.executionPlan,
  });
}

// ---- Query functions ----

export async function getDbAuditLogs(query: DbAuditLogQuery): Promise<PaginatedDbAuditLogs> {
  const page = query.page ?? 1;
  const limit = Math.min(query.limit ?? 50, 100);
  const skip = (page - 1) * limit;

  const where: Prisma.DbAuditLogWhereInput = {
    tenantId: query.tenantId,
  };

  if (query.userId) where.userId = query.userId;
  if (query.connectionId) where.connectionId = query.connectionId;
  if (query.queryType) where.queryType = query.queryType;
  if (query.blocked !== undefined) where.blocked = query.blocked;
  if (query.startDate || query.endDate) {
    where.createdAt = {
      ...(query.startDate && { gte: query.startDate }),
      ...(query.endDate && { lte: query.endDate }),
    };
  }
  if (query.search) {
    const term = query.search;
    where.OR = [
      { queryText: { contains: term, mode: 'insensitive' } },
      { tablesAccessed: { has: term.toLowerCase() } },
      { blockReason: { contains: term, mode: 'insensitive' } },
    ];
  }

  const ALLOWED_SORT_FIELDS = new Set(['createdAt', 'queryType', 'blocked', 'executionTimeMs', 'rowsAffected']);
  const rawSort = query.sortBy ?? '';
  const sortBy = ALLOWED_SORT_FIELDS.has(rawSort) ? rawSort : 'createdAt';
  const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';
  const orderBy: Prisma.DbAuditLogOrderByWithRelationInput = { [sortBy]: sortOrder };

  const [rows, total] = await Promise.all([
    prisma.dbAuditLog.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      include: {
        user: { select: { username: true, email: true } },
        connection: { select: { name: true } },
      },
    }),
    prisma.dbAuditLog.count({ where }),
  ]);

  const data = rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    connectionId: r.connectionId,
    tenantId: r.tenantId,
    queryText: r.queryText,
    queryType: r.queryType,
    tablesAccessed: r.tablesAccessed,
    rowsAffected: r.rowsAffected,
    executionTimeMs: r.executionTimeMs,
    blocked: r.blocked,
    blockReason: r.blockReason,
    executionPlan: r.executionPlan,
    createdAt: r.createdAt,
    userName: r.user?.username ?? null,
    userEmail: r.user?.email ?? null,
    connectionName: r.connection?.name ?? null,
  }));

  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
}

/**
 * Get distinct connections that have DB audit logs for a given tenant.
 */
export async function getDbAuditConnections(tenantId: string): Promise<{ id: string; name: string }[]> {
  const rows = await prisma.dbAuditLog.findMany({
    where: { tenantId },
    select: { connectionId: true },
    distinct: ['connectionId'],
  });

  const connectionIds = rows.map((r) => r.connectionId);
  if (connectionIds.length === 0) return [];

  const connections = await prisma.connection.findMany({
    where: { id: { in: connectionIds } },
    select: { id: true, name: true },
  });

  return connections;
}

/**
 * Get distinct users that have DB audit logs for a given tenant.
 */
export async function getDbAuditUsers(tenantId: string): Promise<{ id: string; username: string | null; email: string }[]> {
  const rows = await prisma.dbAuditLog.findMany({
    where: { tenantId },
    select: { userId: true },
    distinct: ['userId'],
  });

  const userIds = rows.map((r) => r.userId);
  if (userIds.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true, email: true },
  });

  return users;
}
