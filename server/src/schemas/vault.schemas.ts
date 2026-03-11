import { z } from 'zod';

export const unlockSchema = z.object({ password: z.string() });
export type UnlockInput = z.infer<typeof unlockSchema>;

export const codeSchema = z.object({ code: z.string() });
export type CodeInput = z.infer<typeof codeSchema>;

export const credentialSchema = z.object({ credential: z.record(z.string(), z.unknown()) });
export type CredentialInput = z.infer<typeof credentialSchema>;

export const revealSchema = z.object({
  connectionId: z.string().uuid(),
  password: z.string().optional(),
});
export type RevealInput = z.infer<typeof revealSchema>;

export const autoLockSchema = z.object({
  autoLockMinutes: z.number().int().min(0).nullable(),
});
export type AutoLockInput = z.infer<typeof autoLockSchema>;
