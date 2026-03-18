import { z } from 'zod';
import { passwordSchema } from '../utils/validate';

export const updateProfileSchema = z.object({
  username: z.string().min(1).max(50).optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const changePasswordSchema = z.object({
  oldPassword: z.string().optional().default(''),
  newPassword: passwordSchema,
  verificationId: z.string().uuid().optional(),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const initiateEmailChangeSchema = z.object({
  newEmail: z.string().email(),
});
export type InitiateEmailChangeInput = z.infer<typeof initiateEmailChangeSchema>;

export const confirmEmailChangeSchema = z.object({
  codeOld: z.string().length(6).optional(),
  codeNew: z.string().length(6).optional(),
  verificationId: z.string().uuid().optional(),
}).refine(
  (d) => (d.codeOld && d.codeNew) || d.verificationId,
  { message: 'Provide either both OTP codes or a verificationId' },
);
export type ConfirmEmailChangeInput = z.infer<typeof confirmEmailChangeSchema>;

export const initiateIdentitySchema = z.object({
  purpose: z.enum(['email-change', 'password-change', 'admin-action']),
});
export type InitiateIdentityInput = z.infer<typeof initiateIdentitySchema>;

export const confirmIdentitySchema = z.object({
  verificationId: z.string().uuid(),
  code: z.string().optional(),
  credential: z.record(z.string(), z.unknown()).optional(),
  password: z.string().optional(),
});
export type ConfirmIdentityInput = z.infer<typeof confirmIdentitySchema>;

export { sshTerminalConfigSchema as sshDefaultsSchema } from './common.schemas';
export { rdpSettingsSchema as rdpDefaultsSchema } from './common.schemas';

export const uploadAvatarSchema = z.object({
  avatarData: z.string(),
});
export type UploadAvatarInput = z.infer<typeof uploadAvatarSchema>;

export const userSearchSchema = z.object({
  q: z.string().min(1).max(100),
  scope: z.enum(['tenant', 'team']).optional().default('team'),
  teamId: z.string().optional(),
}).refine(
  (data) => !(data.scope === 'team' && !data.teamId),
  { message: 'teamId is required when scope is team', path: ['teamId'] }
);
export type UserSearchInput = z.infer<typeof userSearchSchema>;

export const updateDomainProfileSchema = z.object({
  domainName: z.string().max(100).optional(),
  domainUsername: z.string().max(100).optional(),
  domainPassword: z.string().max(500).nullable().optional(),
});
export type UpdateDomainProfileInput = z.infer<typeof updateDomainProfileSchema>;

const hhmmRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

export const updateNotificationScheduleSchema = z.object({
  dndEnabled: z.boolean().optional(),
  quietHoursStart: z.string().regex(hhmmRegex, 'Must be HH:mm format').nullable().optional(),
  quietHoursEnd: z.string().regex(hhmmRegex, 'Must be HH:mm format').nullable().optional(),
  quietHoursTimezone: z.string().max(100).nullable().optional(),
});
export type UpdateNotificationScheduleInput = z.infer<typeof updateNotificationScheduleSchema>;
