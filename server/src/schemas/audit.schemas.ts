import { z } from 'zod';
import { AuditAction } from '../lib/prisma';

const VALID_ACTIONS = Object.values(AuditAction) as [string, ...string[]];
const VALID_SORT_FIELDS = ['createdAt', 'action'] as const;
const VALID_SORT_ORDERS = ['asc', 'desc'] as const;

export const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  action: z.enum(VALID_ACTIONS).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  search: z.string().max(200).optional(),
  targetType: z.string().max(100).optional(),
  ipAddress: z.string().max(45).optional(),
  gatewayId: z.string().uuid().optional(),
  geoCountry: z.string().max(100).optional(),
  sortBy: z.enum(VALID_SORT_FIELDS).default('createdAt'),
  sortOrder: z.enum(VALID_SORT_ORDERS).default('desc'),
});
export type AuditQueryInput = z.infer<typeof auditQuerySchema>;

export const tenantAuditQuerySchema = auditQuerySchema.extend({
  userId: z.string().uuid().optional(),
});
export type TenantAuditQueryInput = z.infer<typeof tenantAuditQuerySchema>;

export const connectionIdSchema = z.object({
  connectionId: z.string().uuid(),
});
export type ConnectionIdInput = z.infer<typeof connectionIdSchema>;

export const connectionAuditQuerySchema = auditQuerySchema.extend({
  userId: z.string().uuid().optional(),
});
export type ConnectionAuditQueryInput = z.infer<typeof connectionAuditQuerySchema>;
