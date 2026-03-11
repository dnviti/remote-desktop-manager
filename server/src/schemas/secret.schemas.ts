import { z } from 'zod';

const loginDataSchema = z.object({
  type: z.literal('LOGIN'),
  username: z.string().min(1),
  password: z.string().min(1),
  url: z.string().optional(),
  notes: z.string().optional(),
});

const sshKeyDataSchema = z.object({
  type: z.literal('SSH_KEY'),
  username: z.string().optional(),
  privateKey: z.string().min(1),
  publicKey: z.string().optional(),
  passphrase: z.string().optional(),
  algorithm: z.string().optional(),
  notes: z.string().optional(),
});

const certificateDataSchema = z.object({
  type: z.literal('CERTIFICATE'),
  certificate: z.string().min(1),
  privateKey: z.string().min(1),
  chain: z.string().optional(),
  passphrase: z.string().optional(),
  expiresAt: z.string().optional(),
  notes: z.string().optional(),
});

const apiKeyDataSchema = z.object({
  type: z.literal('API_KEY'),
  apiKey: z.string().min(1),
  endpoint: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  notes: z.string().optional(),
});

const secureNoteDataSchema = z.object({
  type: z.literal('SECURE_NOTE'),
  content: z.string().min(1),
});

const secretDataSchema = z.discriminatedUnion('type', [
  loginDataSchema,
  sshKeyDataSchema,
  certificateDataSchema,
  apiKeyDataSchema,
  secureNoteDataSchema,
]);

export const createSecretSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    type: z.enum(['LOGIN', 'SSH_KEY', 'CERTIFICATE', 'API_KEY', 'SECURE_NOTE']),
    scope: z.enum(['PERSONAL', 'TEAM', 'TENANT']),
    teamId: z.string().uuid().optional(),
    folderId: z.string().uuid().optional(),
    data: secretDataSchema,
    metadata: z.record(z.string(), z.unknown()).optional(),
    tags: z.array(z.string()).optional(),
    expiresAt: z.string().datetime().optional(),
  })
  .refine((data) => data.scope !== 'TEAM' || !!data.teamId, {
    message: 'teamId is required for team-scoped secrets',
    path: ['teamId'],
  });
export type CreateSecretInput = z.infer<typeof createSecretSchema>;

export const updateSecretSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  data: secretDataSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  tags: z.array(z.string()).optional(),
  folderId: z.string().uuid().nullable().optional(),
  isFavorite: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  changeNote: z.string().optional(),
});
export type UpdateSecretInput = z.infer<typeof updateSecretSchema>;

export const listFiltersSchema = z.object({
  scope: z.enum(['PERSONAL', 'TEAM', 'TENANT']).optional(),
  type: z.enum(['LOGIN', 'SSH_KEY', 'CERTIFICATE', 'API_KEY', 'SECURE_NOTE']).optional(),
  teamId: z.string().uuid().optional(),
  folderId: z.string().uuid().nullable().optional(),
  search: z.string().optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional(),
  isFavorite: z.enum(['true', 'false']).optional(),
});
export type ListFiltersInput = z.infer<typeof listFiltersSchema>;

export const shareSecretSchema = z
  .object({
    email: z.string().email().optional(),
    userId: z.string().optional(),
    permission: z.enum(['READ_ONLY', 'FULL_ACCESS']),
  })
  .refine((data) => data.email || data.userId, {
    message: 'Either email or userId is required',
  });
export type ShareSecretInput = z.infer<typeof shareSecretSchema>;

export const updateSharePermSchema = z.object({
  permission: z.enum(['READ_ONLY', 'FULL_ACCESS']),
});
export type UpdateSharePermInput = z.infer<typeof updateSharePermSchema>;

export const distributeTenantKeySchema = z.object({
  targetUserId: z.string().uuid(),
});
export type DistributeTenantKeyInput = z.infer<typeof distributeTenantKeySchema>;
