import { z } from 'zod';

export const createGatewaySchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['GUACD', 'SSH_BASTION', 'MANAGED_SSH', 'DB_PROXY']),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  description: z.string().max(500).optional(),
  isDefault: z.boolean().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  sshPrivateKey: z.string().optional(),
  apiPort: z.number().int().min(1).max(65535).optional(),
  publishPorts: z.boolean().optional(),
  lbStrategy: z.enum(['ROUND_ROBIN', 'LEAST_CONNECTIONS']).optional(),
  monitoringEnabled: z.boolean().optional(),
  monitorIntervalMs: z.number().int().min(1000).max(3600000).optional(),
  inactivityTimeoutSeconds: z.number().int().min(60).max(86400).optional(),
});
export type CreateGatewayInput = z.infer<typeof createGatewaySchema>;

export const updateGatewaySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  host: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  description: z.string().max(500).nullable().optional(),
  isDefault: z.boolean().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  sshPrivateKey: z.string().optional(),
  apiPort: z.number().int().min(1).max(65535).nullable().optional(),
  publishPorts: z.boolean().optional(),
  lbStrategy: z.enum(['ROUND_ROBIN', 'LEAST_CONNECTIONS']).optional(),
  monitoringEnabled: z.boolean().optional(),
  monitorIntervalMs: z.number().int().min(1000).max(3600000).optional(),
  inactivityTimeoutSeconds: z.number().int().min(60).max(86400).optional(),
});
export type UpdateGatewayInput = z.infer<typeof updateGatewaySchema>;

export const scaleSchema = z.object({
  replicas: z.number().int().min(0).max(20),
});
export type ScaleInput = z.infer<typeof scaleSchema>;

export const scalingConfigSchema = z.object({
  autoScale: z.boolean().optional(),
  minReplicas: z.number().int().min(0).max(20).optional(),
  maxReplicas: z.number().int().min(1).max(20).optional(),
  sessionsPerInstance: z.number().int().min(1).max(100).optional(),
  scaleDownCooldownSeconds: z.number().int().min(60).max(3600).optional(),
}).refine(
  (data) => {
    if (data.minReplicas !== undefined && data.maxReplicas !== undefined) {
      return data.minReplicas <= data.maxReplicas;
    }
    return true;
  },
  { message: 'minReplicas must be less than or equal to maxReplicas' },
);
export type ScalingConfigInput = z.infer<typeof scalingConfigSchema>;

export const rotationPolicySchema = z.object({
  autoRotateEnabled: z.boolean().optional(),
  rotationIntervalDays: z.number().int().min(1).max(365).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});
export type RotationPolicyInput = z.infer<typeof rotationPolicySchema>;

export const createTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['GUACD', 'SSH_BASTION', 'MANAGED_SSH', 'DB_PROXY']),
  host: z.string().default(''),
  port: z.number().int().min(1).max(65535).optional(),
  description: z.string().max(500).optional(),
  apiPort: z.number().int().min(1).max(65535).optional(),
  autoScale: z.boolean().optional(),
  minReplicas: z.number().int().min(0).max(20).optional(),
  maxReplicas: z.number().int().min(1).max(20).optional(),
  sessionsPerInstance: z.number().int().min(1).max(100).optional(),
  scaleDownCooldownSeconds: z.number().int().min(60).max(3600).optional(),
  monitoringEnabled: z.boolean().optional(),
  monitorIntervalMs: z.number().int().min(1000).max(3600000).optional(),
  inactivityTimeoutSeconds: z.number().int().min(60).max(86400).optional(),
  publishPorts: z.boolean().optional(),
  lbStrategy: z.enum(['ROUND_ROBIN', 'LEAST_CONNECTIONS']).optional(),
}).transform((data) => {
  const isManagedType = data.type === 'MANAGED_SSH' || data.type === 'GUACD' || data.type === 'DB_PROXY';
  return {
    ...data,
    host: isManagedType ? '' : data.host,
    port: data.port ?? (data.type === 'MANAGED_SSH' ? 2222 : data.type === 'GUACD' ? 4822 : data.type === 'DB_PROXY' ? 5432 : undefined),
  };
}).refine(
  (data) => data.port !== undefined,
  { message: 'Port is required for SSH Bastion gateways', path: ['port'] },
);
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

export const updateTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['GUACD', 'SSH_BASTION', 'MANAGED_SSH', 'DB_PROXY']),
  host: z.string(),
  port: z.number().int().min(1).max(65535),
  description: z.string().max(500),
  apiPort: z.number().int().min(1).max(65535),
  autoScale: z.boolean(),
  minReplicas: z.number().int().min(0).max(20),
  maxReplicas: z.number().int().min(1).max(20),
  sessionsPerInstance: z.number().int().min(1).max(100),
  scaleDownCooldownSeconds: z.number().int().min(60).max(3600),
  monitoringEnabled: z.boolean(),
  monitorIntervalMs: z.number().int().min(1000).max(3600000),
  inactivityTimeoutSeconds: z.number().int().min(60).max(86400),
  publishPorts: z.boolean(),
  lbStrategy: z.enum(['ROUND_ROBIN', 'LEAST_CONNECTIONS']),
}).partial();
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
