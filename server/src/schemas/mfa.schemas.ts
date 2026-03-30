import { z } from 'zod';

export const totpCodeSchema = z.object({
  code: z.string().length(6).regex(/^\d{6}$/),
});
export type TotpCodeInput = z.infer<typeof totpCodeSchema>;

export const setupPhoneSchema = z.object({
  phoneNumber: z.string().regex(/^\+[1-9]\d{1,14}$/, 'Invalid E.164 phone number'),
});
export type SetupPhoneInput = z.infer<typeof setupPhoneSchema>;

export const webauthnRegisterSchema = z.object({
  credential: z.record(z.string(), z.unknown()),
  friendlyName: z.string().min(1).max(64).optional(),
  expectedChallenge: z.string().optional(),
});
export type WebauthnRegisterInput = z.infer<typeof webauthnRegisterSchema>;

export const webauthnRenameSchema = z.object({
  friendlyName: z.string().min(1).max(64),
});
export type WebauthnRenameInput = z.infer<typeof webauthnRenameSchema>;
