import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import * as auditService from '../services/audit.service';
import * as permissionService from '../services/permission.service';
import { AppError } from '../middleware/error.middleware';
import { AuditAction } from '../lib/prisma';

const VALID_ACTIONS = Object.values(AuditAction) as [string, ...string[]];
const VALID_SORT_FIELDS = ['createdAt', 'action'] as const;
const VALID_SORT_ORDERS = ['asc', 'desc'] as const;

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  action: z.enum(VALID_ACTIONS).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  search: z.string().max(200).optional(),
  targetType: z.string().max(100).optional(),
  ipAddress: z.string().max(45).optional(),
  gatewayId: z.string().uuid().optional(),
  sortBy: z.enum(VALID_SORT_FIELDS).default('createdAt'),
  sortOrder: z.enum(VALID_SORT_ORDERS).default('desc'),
});

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const query = querySchema.parse(req.query);
    const result = await auditService.getAuditLogs({
      userId: req.user!.userId,
      ...query,
      action: query.action as AuditAction | undefined,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function listGateways(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const gateways = await auditService.getAuditGateways(req.user!.userId);
    res.json(gateways);
  } catch (err) {
    next(err);
  }
}

const tenantQuerySchema = querySchema.extend({
  userId: z.string().uuid().optional(),
});

export async function listTenantLogs(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const query = tenantQuerySchema.parse(req.query);
    const result = await auditService.getTenantAuditLogs({
      tenantId: req.user!.tenantId!,
      ...query,
      action: query.action as AuditAction | undefined,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

const connectionIdSchema = z.object({
  connectionId: z.string().uuid(),
});

const connectionQuerySchema = querySchema.extend({
  userId: z.string().uuid().optional(),
});

export async function listConnectionLogs(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { connectionId } = connectionIdSchema.parse(req.params);
    const query = connectionQuerySchema.parse(req.query);

    const access = await permissionService.canViewConnection(
      req.user!.userId, connectionId, req.user!.tenantId
    );
    if (!access.allowed) {
      return next(new AppError('Connection not found', 404));
    }

    const isAdmin = req.user!.tenantRole === 'ADMIN' || req.user!.tenantRole === 'OWNER';

    const result = await auditService.getConnectionAuditLogs({
      connectionId,
      userId: isAdmin ? query.userId : req.user!.userId,
      isAdmin,
      ...query,
      action: query.action as AuditAction | undefined,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function listConnectionAuditUsers(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { connectionId } = connectionIdSchema.parse(req.params);

    const isAdmin = req.user!.tenantRole === 'ADMIN' || req.user!.tenantRole === 'OWNER';
    if (!isAdmin) {
      return next(new AppError('Forbidden', 403));
    }

    const access = await permissionService.canViewConnection(
      req.user!.userId, connectionId, req.user!.tenantId
    );
    if (!access.allowed) {
      return next(new AppError('Connection not found', 404));
    }

    const users = await auditService.getConnectionAuditUsers(connectionId);
    res.json(users);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function listTenantGateways(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const gateways = await auditService.getTenantAuditGateways(req.user!.tenantId!);
    res.json(gateways);
  } catch (err) {
    next(err);
  }
}
