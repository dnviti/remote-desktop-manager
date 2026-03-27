import prisma, { AuditAction, Prisma } from '../lib/prisma';
import { logger } from '../utils/logger';
import * as geoipService from './geoip.service';
import * as impossibleTravelService from './impossibleTravel.service';

export { AuditAction };

export interface AuditLogInput {
  userId?: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string | string[];
  gatewayId?: string | null;
}

/**
 * Fire-and-forget audit logger. Never throws — errors are logged internally.
 * Enriches entries with geolocation data when MaxMind GeoLite2 database is available.
 */
export function log(input: AuditLogInput): void {
  const ip = (Array.isArray(input.ipAddress) ? input.ipAddress[0] : input.ipAddress) ?? null;
  const geo = geoipService.lookup(ip);

  const geoCoords = geo ? [geo.lat, geo.lng] : [];

  prisma.auditLog
    .create({
      data: {
        userId: input.userId ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        details: (input.details as Prisma.InputJsonValue) ?? undefined,
        ipAddress: ip,
        gatewayId: input.gatewayId ?? null,
        geoCountry: geo?.country ?? null,
        geoCity: geo?.city || null,
        geoCoords,
      },
    })
    .then((entry) => {
      if (input.userId) {
        impossibleTravelService.check(entry.id, input.userId, input.action, geoCoords, entry.createdAt);
      }
    })
    .catch((err) => {
      logger.error('Failed to write audit log:', err instanceof Error ? err.message : 'Unknown error');
    });
}

export interface TenantAuditLogQuery {
  tenantId: string;
  userId?: string;
  page?: number;
  limit?: number;
  action?: AuditAction;
  startDate?: Date;
  endDate?: Date;
  search?: string;
  targetType?: string;
  ipAddress?: string;
  gatewayId?: string;
  geoCountry?: string;
  sortBy?: 'createdAt' | 'action';
  sortOrder?: 'asc' | 'desc';
  flaggedOnly?: boolean;
}

export interface TenantAuditLogEntry extends AuditLogEntry {
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
}

export interface PaginatedTenantAuditLogs {
  data: TenantAuditLogEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AuditLogQuery {
  userId: string;
  page?: number;
  limit?: number;
  action?: AuditAction;
  startDate?: Date;
  endDate?: Date;
  search?: string;
  targetType?: string;
  ipAddress?: string;
  gatewayId?: string;
  geoCountry?: string;
  sortBy?: 'createdAt' | 'action';
  sortOrder?: 'asc' | 'desc';
  flaggedOnly?: boolean;
}

export interface AuditLogEntry {
  id: string;
  action: AuditAction;
  targetType: string | null;
  targetId: string | null;
  details: unknown;
  ipAddress: string | null;
  gatewayId: string | null;
  geoCountry: string | null;
  geoCity: string | null;
  geoCoords: number[];
  flags: string[];
  createdAt: Date;
}

export interface AuditGateway {
  id: string;
  name: string;
}

export interface PaginatedAuditLogs {
  data: AuditLogEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function getAuditLogs(query: AuditLogQuery): Promise<PaginatedAuditLogs> {
  const page = query.page ?? 1;
  const limit = Math.min(query.limit ?? 50, 100);
  const skip = (page - 1) * limit;

  const where: Prisma.AuditLogWhereInput = {
    userId: query.userId,
    ...buildCommonWhereClause(query),
  };

  const sortBy = query.sortBy ?? 'createdAt';
  const sortOrder = query.sortOrder ?? 'desc';
  const orderBy: Prisma.AuditLogOrderByWithRelationInput = { [sortBy]: sortOrder };

  const [data, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        details: true,
        ipAddress: true,
        gatewayId: true,
        geoCountry: true,
        geoCity: true,
        geoCoords: true,
        flags: true,
        createdAt: true,
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getAuditGateways(userId: string): Promise<AuditGateway[]> {
  const rows = await prisma.auditLog.findMany({
    where: { userId, gatewayId: { not: null } },
    select: { gatewayId: true },
    distinct: ['gatewayId'],
  });

  const gatewayIds = rows.map((r) => r.gatewayId).filter((id): id is string => id !== null);
  if (gatewayIds.length === 0) return [];

  const gateways = await prisma.gateway.findMany({
    where: { id: { in: gatewayIds } },
    select: { id: true, name: true },
  });

  const nameMap = new Map(gateways.map((g) => [g.id, g.name]));
  return gatewayIds.map((id) => ({
    id,
    name: nameMap.get(id) ?? `Deleted (${id.slice(0, 8)}…)`,
  }));
}

export function buildCommonWhereClause(opts: {
  action?: AuditAction;
  startDate?: Date;
  endDate?: Date;
  targetType?: string;
  ipAddress?: string;
  gatewayId?: string;
  geoCountry?: string;
  search?: string;
  flaggedOnly?: boolean;
}): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  if (opts.flaggedOnly) where.flags = { isEmpty: false };
  if (opts.action) where.action = opts.action;
  if (opts.startDate || opts.endDate) {
    where.createdAt = {
      ...(opts.startDate && { gte: opts.startDate }),
      ...(opts.endDate && { lte: opts.endDate }),
    };
  }
  if (opts.targetType) where.targetType = opts.targetType;
  if (opts.ipAddress) where.ipAddress = { contains: opts.ipAddress, mode: 'insensitive' };
  if (opts.gatewayId) where.gatewayId = opts.gatewayId;
  if (opts.geoCountry) where.geoCountry = opts.geoCountry;
  if (opts.search) {
    const term = opts.search;
    where.AND = [
      {
        OR: [
          { targetType: { contains: term, mode: 'insensitive' } },
          { targetId: { contains: term, mode: 'insensitive' } },
          { ipAddress: { contains: term, mode: 'insensitive' } },
          { details: { string_contains: term } },
        ],
      },
    ];
  }
  return where;
}

export async function getTenantAuditLogs(query: TenantAuditLogQuery): Promise<PaginatedTenantAuditLogs> {
  const page = query.page ?? 1;
  const limit = Math.min(query.limit ?? 50, 100);
  const skip = (page - 1) * limit;

  const where: Prisma.AuditLogWhereInput = {
    user: { tenantMemberships: { some: { tenantId: query.tenantId, status: 'ACCEPTED' } } },
    ...(query.userId && { userId: query.userId }),
    ...buildCommonWhereClause(query),
  };

  const sortBy = query.sortBy ?? 'createdAt';
  const sortOrder = query.sortOrder ?? 'desc';
  const orderBy: Prisma.AuditLogOrderByWithRelationInput = { [sortBy]: sortOrder };

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      select: {
        id: true,
        userId: true,
        action: true,
        targetType: true,
        targetId: true,
        details: true,
        ipAddress: true,
        gatewayId: true,
        geoCountry: true,
        geoCity: true,
        geoCoords: true,
        flags: true,
        createdAt: true,
        user: { select: { username: true, email: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  const data: TenantAuditLogEntry[] = rows.map((r) => ({
    id: r.id,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    details: r.details,
    ipAddress: r.ipAddress,
    gatewayId: r.gatewayId,
    geoCountry: r.geoCountry,
    geoCity: r.geoCity,
    geoCoords: r.geoCoords,
    flags: r.flags,
    createdAt: r.createdAt,
    userId: r.userId,
    userName: r.user?.username ?? null,
    userEmail: r.user?.email ?? null,
  }));

  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export interface ConnectionAuditLogQuery {
  connectionId: string;
  userId?: string;
  isAdmin: boolean;
  page?: number;
  limit?: number;
  action?: AuditAction;
  startDate?: Date;
  endDate?: Date;
  search?: string;
  ipAddress?: string;
  gatewayId?: string;
  geoCountry?: string;
  sortBy?: 'createdAt' | 'action';
  sortOrder?: 'asc' | 'desc';
  flaggedOnly?: boolean;
}

export async function getConnectionAuditLogs(query: ConnectionAuditLogQuery): Promise<PaginatedTenantAuditLogs> {
  const page = query.page ?? 1;
  const limit = Math.min(query.limit ?? 50, 100);
  const skip = (page - 1) * limit;

  const where: Prisma.AuditLogWhereInput = {
    targetId: query.connectionId,
    ...(query.userId && { userId: query.userId }),
    ...buildCommonWhereClause(query),
  };

  const sortBy = query.sortBy ?? 'createdAt';
  const sortOrder = query.sortOrder ?? 'desc';
  const orderBy: Prisma.AuditLogOrderByWithRelationInput = { [sortBy]: sortOrder };

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      select: {
        id: true,
        userId: true,
        action: true,
        targetType: true,
        targetId: true,
        details: true,
        ipAddress: true,
        gatewayId: true,
        geoCountry: true,
        geoCity: true,
        geoCoords: true,
        flags: true,
        createdAt: true,
        user: { select: { username: true, email: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  const data: TenantAuditLogEntry[] = rows.map((r) => ({
    id: r.id,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    details: r.details,
    ipAddress: r.ipAddress,
    gatewayId: r.gatewayId,
    geoCountry: r.geoCountry,
    geoCity: r.geoCity,
    geoCoords: r.geoCoords,
    flags: r.flags,
    createdAt: r.createdAt,
    userId: r.userId,
    userName: r.user?.username ?? null,
    userEmail: r.user?.email ?? null,
  }));

  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export interface ConnectionAuditUser {
  id: string;
  username: string | null;
  email: string;
}

export async function getConnectionAuditUsers(connectionId: string): Promise<ConnectionAuditUser[]> {
  const rows = await prisma.auditLog.findMany({
    where: { targetId: connectionId, userId: { not: null } },
    select: { userId: true },
    distinct: ['userId'],
  });

  const userIds = rows.map((r) => r.userId).filter((id): id is string => id !== null);
  if (userIds.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true, email: true },
  });

  return users;
}

export async function getTenantAuditGateways(tenantId: string): Promise<AuditGateway[]> {
  const members = await prisma.tenantMember.findMany({
    where: { tenantId },
    select: { userId: true },
  });
  const ids = members.map((m) => m.userId);
  if (ids.length === 0) return [];

  const rows = await prisma.auditLog.findMany({
    where: { userId: { in: ids }, gatewayId: { not: null } },
    select: { gatewayId: true },
    distinct: ['gatewayId'],
  });

  const gatewayIds = rows.map((r) => r.gatewayId).filter((id): id is string => id !== null);
  if (gatewayIds.length === 0) return [];

  const gateways = await prisma.gateway.findMany({
    where: { id: { in: gatewayIds } },
    select: { id: true, name: true },
  });

  const nameMap = new Map(gateways.map((g) => [g.id, g.name]));
  return gatewayIds.map((id) => ({
    id,
    name: nameMap.get(id) ?? `Deleted (${id.slice(0, 8)}…)`,
  }));
}

/**
 * Get distinct countries found in a user's audit logs.
 */
export async function getAuditCountries(userId: string): Promise<string[]> {
  const rows = await prisma.auditLog.findMany({
    where: { userId, geoCountry: { not: null } },
    select: { geoCountry: true },
    distinct: ['geoCountry'],
    orderBy: { geoCountry: 'asc' },
  });
  return rows.map((r) => r.geoCountry).filter((c): c is string => c !== null);
}

/**
 * Get distinct countries found in a tenant's audit logs.
 */
export interface GeoSummaryPoint {
  lat: number;
  lng: number;
  country: string;
  city: string;
  count: number;
  lastSeen: Date;
}

/**
 * Get geo-aggregated summary of audit events for a tenant.
 * Groups by country+city and returns points with coordinates for map rendering.
 */
export async function getTenantGeoSummary(tenantId: string, days: number = 30): Promise<GeoSummaryPoint[]> {
  const members = await prisma.tenantMember.findMany({
    where: { tenantId },
    select: { userId: true },
  });
  const ids = members.map((m) => m.userId);
  if (ids.length === 0) return [];

  const since = new Date();
  since.setDate(since.getDate() - days);

  const rows = await prisma.auditLog.findMany({
    where: {
      userId: { in: ids },
      geoCountry: { not: null },
      geoCoords: { isEmpty: false },
      createdAt: { gte: since },
    },
    select: {
      geoCountry: true,
      geoCity: true,
      geoCoords: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  // Group by country+city and aggregate
  const groups = new Map<string, GeoSummaryPoint>();
  for (const row of rows) {
    if (!row.geoCountry || row.geoCoords.length < 2) continue;
    const key = `${row.geoCountry}|${row.geoCity ?? ''}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      // lastSeen is already the most recent due to orderBy desc
    } else {
      groups.set(key, {
        lat: row.geoCoords[0],
        lng: row.geoCoords[1],
        country: row.geoCountry,
        city: row.geoCity ?? '',
        count: 1,
        lastSeen: row.createdAt,
      });
    }
  }

  return Array.from(groups.values());
}

export async function getTenantAuditCountries(tenantId: string): Promise<string[]> {
  const members = await prisma.tenantMember.findMany({
    where: { tenantId },
    select: { userId: true },
  });
  const ids = members.map((m) => m.userId);
  if (ids.length === 0) return [];

  const rows = await prisma.auditLog.findMany({
    where: { userId: { in: ids }, geoCountry: { not: null } },
    select: { geoCountry: true },
    distinct: ['geoCountry'],
    orderBy: { geoCountry: 'asc' },
  });
  return rows.map((r) => r.geoCountry).filter((c): c is string => c !== null);
}
