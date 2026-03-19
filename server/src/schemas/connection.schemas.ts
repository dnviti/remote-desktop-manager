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

export const createConnectionSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['RDP', 'SSH', 'VNC', 'DATABASE']),
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
}).refine(
  (data) => data.credentialSecretId || data.externalVaultProviderId || (data.username !== undefined && data.password !== undefined),
  { message: 'Either credentialSecretId, externalVaultProviderId, or both username and password must be provided' }
).refine(
  (data) => !data.externalVaultProviderId || (data.externalVaultPath && data.externalVaultPath.trim().length > 0),
  { message: 'externalVaultPath is required when externalVaultProviderId is set', path: ['externalVaultPath'] }
);

export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;

export const updateConnectionSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(['RDP', 'SSH', 'VNC', 'DATABASE']).optional(),
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
}).refine(
  (data) => !data.externalVaultProviderId || (data.externalVaultPath && data.externalVaultPath.trim().length > 0),
  { message: 'externalVaultPath is required when externalVaultProviderId is set', path: ['externalVaultPath'] }
);

export type UpdateConnectionInput = z.infer<typeof updateConnectionSchema>;
