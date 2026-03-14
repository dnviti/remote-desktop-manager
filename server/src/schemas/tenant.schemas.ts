import * as net from 'net';
import { z } from 'zod';
import { passwordSchema } from '../utils/validate';
import { sshTerminalConfigSchema, rdpSettingsSchema, vncSettingsSchema } from './common.schemas';

export const enforcedConnectionSettingsSchema = z.object({
  ssh: sshTerminalConfigSchema.optional(),
  rdp: rdpSettingsSchema.optional(),
  vnc: vncSettingsSchema.optional(),
}).optional().nullable();

export type EnforcedConnectionSettings = z.infer<typeof enforcedConnectionSettingsSchema>;

export const createTenantSchema = z.object({
  name: z.string().min(2).max(100),
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

export const updateTenantSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  defaultSessionTimeoutSeconds: z.number().int().min(60).max(86400).optional(),
  maxConcurrentSessions: z.number().int().min(0).max(100).optional(),
  absoluteSessionTimeoutSeconds: z.number().int().min(0).max(604800).optional(),
  mfaRequired: z.boolean().optional(),
  vaultAutoLockMaxMinutes: z.number().int().min(0).nullable().optional(),
  dlpDisableCopy: z.boolean().optional(),
  dlpDisablePaste: z.boolean().optional(),
  dlpDisableDownload: z.boolean().optional(),
  dlpDisableUpload: z.boolean().optional(),
  enforcedConnectionSettings: enforcedConnectionSettingsSchema,
});
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

export const inviteUserSchema = z.object({
  email: z.string().email(),
  role: z.enum(['ADMIN', 'OPERATOR', 'MEMBER', 'CONSULTANT', 'AUDITOR', 'GUEST']),
  expiresAt: z.string().datetime().optional().nullable(),
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
  expiresAt: z.string().datetime().optional().nullable(),
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

export const updateMembershipExpirySchema = z.object({
  expiresAt: z.string().datetime().nullable(),
});
export type UpdateMembershipExpiryInput = z.infer<typeof updateMembershipExpirySchema>;

// IPv4 CIDR: e.g. 10.0.0.0/8  |  IPv6 CIDR: e.g. 2001:db8::/32  |  single IPs without prefix
// eslint-disable-next-line security/detect-unsafe-regex
const cidrRegex = /^(?:(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?|[0-9a-fA-F:]+(?:\/\d{1,3})?)$/;
export const ipAllowlistSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['flag', 'block']),
  entries: z.array(z.string().regex(cidrRegex, 'Invalid IP/CIDR format')).max(200)
    .refine((entries) => {
      return entries.every((entry) => {
        const slash = entry.lastIndexOf('/');
        if (slash === -1) {
          // Bare IP — must be a valid IPv4 or IPv6 address
          return net.isIPv4(entry) || net.isIPv6(entry);
        }
        const ip = entry.substring(0, slash);
        const prefix = parseInt(entry.substring(slash + 1), 10);
        if (net.isIPv4(ip)) return prefix >= 0 && prefix <= 32;
        if (net.isIPv6(ip)) return prefix >= 0 && prefix <= 128;
        return false;
      });
    }, { message: 'Invalid IP address or CIDR notation' }),
});
export type IpAllowlistInput = z.infer<typeof ipAllowlistSchema>;
