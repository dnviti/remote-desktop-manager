import { z } from 'zod';

export const dbTunnelSchema = z.object({
  connectionId: z.string().uuid(),
  dbUsername: z.string().min(1).optional(),
  dbPassword: z.string().min(1).optional(),
  dbName: z.string().min(1).optional(),
  dbType: z.string().min(1).optional(),
});

export type DbTunnelInput = z.infer<typeof dbTunnelSchema>;
