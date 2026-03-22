import { z } from 'zod';

export const createCheckoutSchema = z.object({
  secretId: z.string().uuid().optional(),
  connectionId: z.string().uuid().optional(),
  durationMinutes: z.number().int().min(1).max(1440),
  reason: z.string().max(500).optional(),
}).refine(
  (data) => (data.secretId && !data.connectionId) || (!data.secretId && data.connectionId),
  { message: 'Provide either secretId or connectionId, not both' },
);

export type CreateCheckoutInput = z.infer<typeof createCheckoutSchema>;

export const listCheckoutSchema = z.object({
  role: z.enum(['requester', 'approver', 'all']).optional().default('all'),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CHECKED_IN']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type ListCheckoutInput = z.infer<typeof listCheckoutSchema>;
