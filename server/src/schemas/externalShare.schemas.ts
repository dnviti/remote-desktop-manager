import { z } from 'zod';

export const createExternalShareSchema = z.object({
  expiresInMinutes: z.number().int().min(5).max(43200),
  maxAccessCount: z.number().int().min(1).max(1000).optional(),
  pin: z.string().regex(/^\d{4,8}$/, 'PIN must be 4-8 digits').optional(),
});

export type CreateExternalShareInput = z.infer<typeof createExternalShareSchema>;

export const accessExternalShareSchema = z.object({
  pin: z.string().regex(/^\d{4,8}$/).optional(),
});

export type AccessExternalShareInput = z.infer<typeof accessExternalShareSchema>;
