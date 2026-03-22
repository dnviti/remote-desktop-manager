import { z } from 'zod';

export const updateSettingSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean()]),
});

export const bulkUpdateSettingsSchema = z.object({
  updates: z.array(
    z.object({
      key: z.string().min(1),
      value: z.union([z.string(), z.number(), z.boolean()]),
    }),
  ).min(1).max(100),
});
