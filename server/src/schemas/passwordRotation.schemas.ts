import { z } from 'zod';

export const enableRotationSchema = z.object({
  intervalDays: z.number().int().min(1).max(365).optional().default(30),
});
export type EnableRotationInput = z.infer<typeof enableRotationSchema>;

export const triggerRotationSchema = z.object({});
export type TriggerRotationInput = z.infer<typeof triggerRotationSchema>;
