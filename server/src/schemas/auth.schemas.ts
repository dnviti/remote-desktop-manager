import { z } from 'zod';
import { passwordSchema } from '../utils/validate';

export const registerSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const verifyTotpSchema = z.object({
  tempToken: z.string(),
  code: z.string().length(6).regex(/^\d{6}$/),
});
export type VerifyTotpInput = z.infer<typeof verifyTotpSchema>;

export const requestSmsSchema = z.object({
  tempToken: z.string(),
});
export type RequestSmsInput = z.infer<typeof requestSmsSchema>;

export const verifySmsSchema = z.object({
  tempToken: z.string(),
  code: z.string().length(6).regex(/^\d{6}$/),
});
export type VerifySmsInput = z.infer<typeof verifySmsSchema>;

export const requestWebAuthnSchema = z.object({
  tempToken: z.string(),
});
export type RequestWebAuthnInput = z.infer<typeof requestWebAuthnSchema>;

export const verifyWebAuthnSchema = z.object({
  tempToken: z.string(),
  credential: z.record(z.string(), z.unknown()),
});
export type VerifyWebAuthnInput = z.infer<typeof verifyWebAuthnSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().length(64),
});
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const resendVerificationSchema = z.object({
  email: z.string().email(),
});
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;

export const mfaSetupTokenSchema = z.object({
  tempToken: z.string(),
});
export type MfaSetupTokenInput = z.infer<typeof mfaSetupTokenSchema>;

export const mfaSetupVerifySchema = z.object({
  tempToken: z.string(),
  code: z.string().length(6).regex(/^\d{6}$/),
});
export type MfaSetupVerifyInput = z.infer<typeof mfaSetupVerifySchema>;

export const switchTenantSchema = z.object({
  tenantId: z.string().uuid(),
});
export type SwitchTenantInput = z.infer<typeof switchTenantSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetTokenSchema = z.object({
  token: z.string().length(64),
});
export type ResetTokenInput = z.infer<typeof resetTokenSchema>;

export const completeResetSchema = z.object({
  token: z.string().length(64),
  newPassword: passwordSchema,
  smsCode: z.string().length(6).regex(/^\d{6}$/).optional(),
  recoveryKey: z.string().optional(),
});
export type CompleteResetInput = z.infer<typeof completeResetSchema>;
