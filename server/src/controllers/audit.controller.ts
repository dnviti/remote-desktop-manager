import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import * as auditService from '../services/audit.service';
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
