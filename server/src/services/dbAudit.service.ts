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
 * Classify a SQL query text into a DbQueryType.
 */
export function classifyQuery(queryText: string): DbQueryType {
  const trimmed = queryText.trim();
  if (DDL_KEYWORDS.test(trimmed)) return 'DDL';
  if (SELECT_KEYWORDS.test(trimmed)) return 'SELECT';
  if (INSERT_KEYWORDS.test(trimmed)) return 'INSERT';
  if (UPDATE_KEYWORDS.test(trimmed)) return 'UPDATE';
  if (DELETE_KEYWORDS.test(trimmed)) return 'DELETE';
  return 'OTHER';
}

/**
 * Extract table names from a SQL query (best effort, covers common patterns).
 */
export function extractTables(queryText: string): string[] {
  const tables = new Set<string>();
  const patterns = [
    /\bFROM\s+(["`]?\w+["`]?(?:\s*\.\s*["`]?\w+["`]?)?)/gi,
    /\bJOIN\s+(["`]?\w+["`]?(?:\s*\.\s*["`]?\w+["`]?)?)/gi,
    /\bINTO\s+(["`]?\w+["`]?(?:\s*\.\s*["`]?\w+["`]?)?)/gi,
    /\bUPDATE\s+(["`]?\w+["`]?(?:\s*\.\s*["`]?\w+["`]?)?)/gi,
    /\bTABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(["`]?\w+["`]?(?:\s*\.\s*["`]?\w+["`]?)?)/gi,
    /\bTRUNCATE\s+(?:TABLE\s+)?(["`]?\w+["`]?(?:\s*\.\s*["`]?\w+["`]?)?)/gi,
  ];

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
      },
    })
    .catch((err) => {
      log.error('Failed to write DB audit log:', err);
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

  const sortBy = query.sortBy ?? 'createdAt';
  const sortOrder = query.sortOrder ?? 'desc';
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
