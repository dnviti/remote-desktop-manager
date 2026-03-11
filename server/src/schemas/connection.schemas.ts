import { z } from 'zod';
import { sshTerminalConfigSchema, rdpSettingsSchema, vncSettingsSchema } from './common.schemas';

export const createConnectionSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['RDP', 'SSH', 'VNC']),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  username: z.string().optional(),
  password: z.string().optional(),
  domain: z.string().optional(),
  credentialSecretId: z.string().uuid().optional(),
  description: z.string().optional(),
  folderId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  enableDrive: z.boolean().optional(),
  gatewayId: z.string().uuid().nullable().optional(),
  sshTerminalConfig: sshTerminalConfigSchema.optional(),
  rdpSettings: rdpSettingsSchema.optional(),
  vncSettings: vncSettingsSchema.optional(),
  defaultCredentialMode: z.enum(['saved', 'domain', 'prompt']).nullable().optional(),
}).refine(
  (data) => data.credentialSecretId || (data.username !== undefined && data.password !== undefined),
  { message: 'Either credentialSecretId or both username and password must be provided' }
);

export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;

export const updateConnectionSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(['RDP', 'SSH', 'VNC']).optional(),
  host: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  domain: z.string().optional(),
  credentialSecretId: z.string().uuid().nullable().optional(),
  description: z.string().nullable().optional(),
  folderId: z.string().uuid().nullable().optional(),
  enableDrive: z.boolean().optional(),
  gatewayId: z.string().uuid().nullable().optional(),
  sshTerminalConfig: sshTerminalConfigSchema.nullable().optional(),
  rdpSettings: rdpSettingsSchema.nullable().optional(),
  vncSettings: vncSettingsSchema.nullable().optional(),
  defaultCredentialMode: z.enum(['saved', 'domain', 'prompt']).nullable().optional(),
});

export type UpdateConnectionInput = z.infer<typeof updateConnectionSchema>;
