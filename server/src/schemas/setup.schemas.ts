import { z } from 'zod';
import { passwordSchema } from '../utils/validate';

export const setupCompleteSchema = z.object({
  admin: z.object({
    email: z.string().email(),
    username: z.string().min(2).max(50).optional(),
    password: passwordSchema,
  }),
  tenant: z.object({
    name: z.string().min(1).max(100),
  }),
  settings: z.object({
    selfSignupEnabled: z.boolean().optional(),
    smtp: z.object({
      host: z.string().min(1),
      port: z.number().int().min(1).max(65535),
      user: z.string().optional(),
      pass: z.string().optional(),
      from: z.string().email().optional(),
      secure: z.boolean().optional(),
    }).optional(),
  }).optional(),
});

export type SetupCompleteInput = z.infer<typeof setupCompleteSchema>;
