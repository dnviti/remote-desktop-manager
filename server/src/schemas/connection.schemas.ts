import { z } from 'zod';
import { sshTerminalConfigSchema, rdpSettingsSchema, vncSettingsSchema, dlpPolicySchema } from './common.schemas';

const dbSettingsSchema = z.object({
  protocol: z.enum(['postgresql', 'mysql', 'mongodb', 'oracle', 'mssql', 'db2']),
  databaseName: z.string().max(255).optional(),
  oracleSid: z.string().max(255).optional(),
  oracleServiceName: z.string().max(255).optional(),
  mssqlInstanceName: z.string().max(255).optional(),
  mssqlAuthMode: z.enum(['sql', 'windows']).optional(),
  db2DatabaseAlias: z.string().max(255).optional(),
}).optional();

const createConnectionBaseSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['RDP', 'SSH', 'VNC', 'DATABASE', 'DB_TUNNEL']),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  username: z.string().optional(),
  password: z.string().optional(),
  domain: z.string().optional(),
  credentialSecretId: z.string().uuid().optional(),
  externalVaultProviderId: z.string().uuid().nullable().optional(),
  externalVaultPath: z.string().max(500).nullable().optional(),
  description: z.string().optional(),
  folderId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  enableDrive: z.boolean().optional(),
  gatewayId: z.string().uuid().nullable().optional(),
  sshTerminalConfig: sshTerminalConfigSchema.optional(),
  rdpSettings: rdpSettingsSchema.optional(),
  vncSettings: vncSettingsSchema.optional(),
  dbSettings: dbSettingsSchema,
  dlpPolicy: dlpPolicySchema.nullable().optional(),
  defaultCredentialMode: z.enum(['saved', 'domain', 'prompt']).nullable().optional(),
  // DB_TUNNEL-specific fields
  targetDbHost: z.string().min(1).optional(),
  targetDbPort: z.number().int().min(1).max(65535).optional(),
  dbType: z.string().min(1).optional(),
  bastionConnectionId: z.string().uuid().nullable().optional(),
});

export const createConnectionSchema = createConnectionBaseSchema.refine(
  (data) => data.credentialSecretId || data.externalVaultProviderId || (data.username !== undefined && data.password !== undefined),
  { message: 'Either credentialSecretId, externalVaultProviderId, or both username and password must be provided' }
).refine(
  (data) => !data.externalVaultProviderId || (data.externalVaultPath && data.externalVaultPath.trim().length > 0),
  { message: 'externalVaultPath is required when externalVaultProviderId is set', path: ['externalVaultPath'] }
).refine(
  (data) => data.type !== 'DB_TUNNEL' || (data.targetDbHost && data.targetDbPort),
  { message: 'targetDbHost and targetDbPort are required for DB_TUNNEL connections' }
);

export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;

const updateConnectionBaseSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(['RDP', 'SSH', 'VNC', 'DATABASE', 'DB_TUNNEL']).optional(),
  host: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  domain: z.string().optional(),
  credentialSecretId: z.string().uuid().nullable().optional(),
  externalVaultProviderId: z.string().uuid().nullable().optional(),
  externalVaultPath: z.string().max(500).nullable().optional(),
  description: z.string().nullable().optional(),
  folderId: z.string().uuid().nullable().optional(),
  enableDrive: z.boolean().optional(),
  gatewayId: z.string().uuid().nullable().optional(),
  sshTerminalConfig: sshTerminalConfigSchema.nullable().optional(),
  rdpSettings: rdpSettingsSchema.nullable().optional(),
  vncSettings: vncSettingsSchema.nullable().optional(),
  dbSettings: dbSettingsSchema.nullable().optional(),
  dlpPolicy: dlpPolicySchema.nullable().optional(),
  defaultCredentialMode: z.enum(['saved', 'domain', 'prompt']).nullable().optional(),
  // DB_TUNNEL-specific fields
  targetDbHost: z.string().min(1).nullable().optional(),
  targetDbPort: z.number().int().min(1).max(65535).nullable().optional(),
  dbType: z.string().min(1).nullable().optional(),
  bastionConnectionId: z.string().uuid().nullable().optional(),
});

export const updateConnectionSchema = updateConnectionBaseSchema.refine(
  (data) => !data.externalVaultProviderId || (data.externalVaultPath && data.externalVaultPath.trim().length > 0),
  { message: 'externalVaultPath is required when externalVaultProviderId is set', path: ['externalVaultPath'] }
);

export type UpdateConnectionInput = z.infer<typeof updateConnectionSchema>;
