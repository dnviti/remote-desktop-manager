import { z } from 'zod';

export const sessionSchema = z.object({
  connectionId: z.string().uuid(),
  username: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
  domain: z.string().min(1).optional(),
  credentialMode: z.enum(['saved', 'domain', 'manual']).optional(),
}).refine(
  (data) => data.credentialMode === 'domain' || (!data.username && !data.password) || (data.username && data.password),
  { message: 'Both username and password must be provided together' },
);

export type SessionInput = z.infer<typeof sessionSchema>;
