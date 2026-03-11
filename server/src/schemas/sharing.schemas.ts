import { z } from 'zod';

export const shareSchema = z.object({
  email: z.string().email().optional(),
  userId: z.string().optional(),
  permission: z.enum(['READ_ONLY', 'FULL_ACCESS']),
}).refine(
  (data) => data.email || data.userId,
  { message: 'Either email or userId is required' }
);

export type ShareInput = z.infer<typeof shareSchema>;

export const batchShareSchema = z.object({
  connectionIds: z.array(z.string().uuid()).min(1).max(50),
  target: z.union([
    z.object({ email: z.string().email(), userId: z.undefined().optional() }),
    z.object({ userId: z.string().uuid(), email: z.undefined().optional() }),
  ]),
  permission: z.enum(['READ_ONLY', 'FULL_ACCESS']),
  folderName: z.string().optional(),
});

export type BatchShareInput = z.infer<typeof batchShareSchema>;

export const updatePermissionSchema = z.object({
  permission: z.enum(['READ_ONLY', 'FULL_ACCESS']),
});

export type UpdatePermissionInput = z.infer<typeof updatePermissionSchema>;
