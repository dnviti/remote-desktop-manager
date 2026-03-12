import { z } from 'zod';
import { passwordSchema } from '../utils/validate';

export const createTenantSchema = z.object({
  name: z.string().min(2).max(100),
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

export const updateTenantSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  defaultSessionTimeoutSeconds: z.number().int().min(60).max(86400).optional(),
  mfaRequired: z.boolean().optional(),
  vaultAutoLockMaxMinutes: z.number().int().min(0).nullable().optional(),
});
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

export const inviteUserSchema = z.object({
  email: z.string().email(),
  role: z.enum(['ADMIN', 'OPERATOR', 'MEMBER', 'CONSULTANT', 'AUDITOR', 'GUEST']),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const updateRoleSchema = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'OPERATOR', 'MEMBER', 'CONSULTANT', 'AUDITOR', 'GUEST']),
});
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

export const createUserSchema = z.object({
  email: z.string().email(),
  username: z.string().min(1).max(100).optional(),
  password: passwordSchema,
  role: z.enum(['ADMIN', 'OPERATOR', 'MEMBER', 'CONSULTANT', 'AUDITOR', 'GUEST']),
  sendWelcomeEmail: z.boolean().optional().default(false),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const toggleUserEnabledSchema = z.object({
  enabled: z.boolean(),
});
export type ToggleUserEnabledInput = z.infer<typeof toggleUserEnabledSchema>;

export const adminChangeEmailSchema = z.object({
  newEmail: z.string().email(),
  verificationId: z.string().uuid(),
});
export type AdminChangeEmailInput = z.infer<typeof adminChangeEmailSchema>;

export const adminChangePasswordSchema = z.object({
  newPassword: passwordSchema,
  verificationId: z.string().uuid(),
});
export type AdminChangePasswordInput = z.infer<typeof adminChangePasswordSchema>;
