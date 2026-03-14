import { z } from 'zod';

export const createVaultProviderSchema = z.object({
  name: z.string().min(1).max(100),
  serverUrl: z.string().url(),
  authMethod: z.enum(['TOKEN', 'APPROLE']),
  namespace: z.string().max(200).optional(),
  mountPath: z.string().min(1).max(200).optional(),
  authPayload: z.string().min(1),
  caCertificate: z.string().optional(),
  cacheTtlSeconds: z.number().int().min(0).max(86400).optional(),
}).refine(
  (data) => {
    try {
      const parsed = JSON.parse(data.authPayload);
      if (typeof parsed !== 'object' || parsed === null) return false;
      if (data.authMethod === 'TOKEN') return typeof parsed.token === 'string' && parsed.token.length > 0;
      if (data.authMethod === 'APPROLE') return typeof parsed.roleId === 'string' && parsed.roleId.length > 0
        && typeof parsed.secretId === 'string' && parsed.secretId.length > 0;
      return false;
    } catch {
      return false;
    }
  },
  { message: 'authPayload must be valid JSON with the expected keys for the selected authMethod (TOKEN: { token }, APPROLE: { roleId, secretId })', path: ['authPayload'] }
);
export type CreateVaultProviderInput = z.infer<typeof createVaultProviderSchema>;

export const updateVaultProviderSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  serverUrl: z.string().url().optional(),
  authMethod: z.enum(['TOKEN', 'APPROLE']).optional(),
  namespace: z.string().max(200).nullable().optional(),
  mountPath: z.string().min(1).max(200).optional(),
  authPayload: z.string().min(1).optional(),
  caCertificate: z.string().nullable().optional(),
  cacheTtlSeconds: z.number().int().min(0).max(86400).optional(),
  enabled: z.boolean().optional(),
}).refine(
  (data) => {
    if (!data.authPayload) return true; // authPayload is optional on update
    if (!data.authMethod) return true; // without authMethod, we can't validate structure; service layer handles it
    try {
      const parsed = JSON.parse(data.authPayload);
      if (typeof parsed !== 'object' || parsed === null) return false;
      if (data.authMethod === 'TOKEN') return typeof parsed.token === 'string' && parsed.token.length > 0;
      if (data.authMethod === 'APPROLE') return typeof parsed.roleId === 'string' && parsed.roleId.length > 0
        && typeof parsed.secretId === 'string' && parsed.secretId.length > 0;
      return false;
    } catch {
      return false;
    }
  },
  { message: 'authPayload must be valid JSON with the expected keys for the selected authMethod (TOKEN: { token }, APPROLE: { roleId, secretId })', path: ['authPayload'] }
);
export type UpdateVaultProviderInput = z.infer<typeof updateVaultProviderSchema>;

export const testVaultProviderSchema = z.object({
  secretPath: z.string().min(1).max(500),
});
export type TestVaultProviderInput = z.infer<typeof testVaultProviderSchema>;
