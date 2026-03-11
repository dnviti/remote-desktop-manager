import { z } from 'zod';

export const testEmailSchema = z.object({
  to: z.string().email(),
});
export type TestEmailInput = z.infer<typeof testEmailSchema>;

export const selfSignupSchema = z.object({
  enabled: z.boolean(),
});
export type SelfSignupInput = z.infer<typeof selfSignupSchema>;
