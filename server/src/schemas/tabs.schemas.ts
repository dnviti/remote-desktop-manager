import { z } from 'zod';

export const syncTabsSchema = z.object({
  tabs: z.array(
    z.object({
      connectionId: z.string().uuid(),
      sortOrder: z.number().int().min(0),
      isActive: z.boolean(),
    }),
  ).max(50),
});

export type SyncTabsInput = z.infer<typeof syncTabsSchema>;
