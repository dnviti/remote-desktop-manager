import { z } from 'zod';

export const ipParamSchema = z.object({
  ip: z.string().min(1).max(45),
});
export type IpParamInput = z.infer<typeof ipParamSchema>;
