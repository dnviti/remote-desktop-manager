import { z } from 'zod';

// All supported provider types
const providerTypes = [
  'HASHICORP_VAULT',
  'AWS_SECRETS_MANAGER',
  'AZURE_KEY_VAULT',
  'GCP_SECRET_MANAGER',
  'CYBERARK_CONJUR',
] as const;

// All supported auth methods
const authMethods = [
  'TOKEN', 'APPROLE',
  'IAM_ACCESS_KEY', 'IAM_ROLE',
  'CLIENT_CREDENTIALS', 'MANAGED_IDENTITY',
  'SERVICE_ACCOUNT_KEY', 'WORKLOAD_IDENTITY',
  'CONJUR_API_KEY', 'CONJUR_AUTHN_K8S',
] as const;

// Auth methods allowed per provider type (mirrors AUTH_METHODS_BY_PROVIDER in vaultAdapters/index.ts)
const authMethodsByProvider: Record<string, readonly string[]> = {
  HASHICORP_VAULT: ['TOKEN', 'APPROLE'],
  AWS_SECRETS_MANAGER: ['IAM_ACCESS_KEY', 'IAM_ROLE'],
  AZURE_KEY_VAULT: ['CLIENT_CREDENTIALS', 'MANAGED_IDENTITY'],
  GCP_SECRET_MANAGER: ['SERVICE_ACCOUNT_KEY', 'WORKLOAD_IDENTITY'],
  CYBERARK_CONJUR: ['CONJUR_API_KEY', 'CONJUR_AUTHN_K8S'],
};

// Auth method → required payload keys
function validateAuthPayload(authMethod: string, parsed: Record<string, unknown>): boolean {
  switch (authMethod) {
    case 'TOKEN':
      return typeof parsed.token === 'string' && parsed.token.length > 0;
    case 'APPROLE':
      return typeof parsed.roleId === 'string' && parsed.roleId.length > 0
        && typeof parsed.secretId === 'string' && parsed.secretId.length > 0;
    case 'IAM_ACCESS_KEY':
      return typeof parsed.accessKeyId === 'string' && parsed.accessKeyId.length > 0
        && typeof parsed.secretAccessKey === 'string' && parsed.secretAccessKey.length > 0;
    case 'IAM_ROLE':
      // region is optional (defaults to us-east-1); credentials come from environment
      return true;
    case 'CLIENT_CREDENTIALS':
      return typeof parsed.tenantId === 'string' && parsed.tenantId.length > 0
        && typeof parsed.clientId === 'string' && parsed.clientId.length > 0
        && typeof parsed.clientSecret === 'string' && parsed.clientSecret.length > 0;
    case 'MANAGED_IDENTITY':
      // clientId is optional
      return true;
    case 'SERVICE_ACCOUNT_KEY':
      return typeof parsed.serviceAccountKey === 'string' && parsed.serviceAccountKey.length > 0;
    case 'WORKLOAD_IDENTITY':
      return typeof parsed.projectId === 'string' && parsed.projectId.length > 0;
    case 'CONJUR_API_KEY':
      return typeof parsed.login === 'string' && parsed.login.length > 0
        && typeof parsed.apiKey === 'string' && parsed.apiKey.length > 0
        && typeof parsed.account === 'string' && parsed.account.length > 0;
    case 'CONJUR_AUTHN_K8S':
      return typeof parsed.serviceId === 'string' && parsed.serviceId.length > 0
        && typeof parsed.account === 'string' && parsed.account.length > 0;
    default:
      return false;
  }
}

export const createVaultProviderSchema = z.object({
  name: z.string().min(1).max(100),
  providerType: z.enum(providerTypes).optional().default('HASHICORP_VAULT'),
  serverUrl: z.string().url(),
  authMethod: z.enum(authMethods),
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
      return validateAuthPayload(data.authMethod, parsed as Record<string, unknown>);
    } catch {
      return false;
    }
  },
  { message: 'authPayload must be valid JSON with the expected keys for the selected authMethod', path: ['authPayload'] }
).refine(
  (data) => {
    const allowed = authMethodsByProvider[data.providerType];
    return allowed ? allowed.includes(data.authMethod) : false;
  },
  { message: 'authMethod is not supported for the selected providerType', path: ['authMethod'] }
);
export type CreateVaultProviderInput = z.infer<typeof createVaultProviderSchema>;

export const updateVaultProviderSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  providerType: z.enum(providerTypes).optional(),
  serverUrl: z.string().url().optional(),
  authMethod: z.enum(authMethods).optional(),
  namespace: z.string().max(200).nullable().optional(),
  mountPath: z.string().min(1).max(200).optional(),
  authPayload: z.string().min(1).optional(),
  caCertificate: z.string().nullable().optional(),
  cacheTtlSeconds: z.number().int().min(0).max(86400).optional(),
  enabled: z.boolean().optional(),
}).refine(
  (data) => {
    if (!data.authPayload) return true;
    if (!data.authMethod) return true;
    try {
      const parsed = JSON.parse(data.authPayload);
      if (typeof parsed !== 'object' || parsed === null) return false;
      return validateAuthPayload(data.authMethod, parsed as Record<string, unknown>);
    } catch {
      return false;
    }
  },
  { message: 'authPayload must be valid JSON with the expected keys for the selected authMethod', path: ['authPayload'] }
).refine(
  (data) => {
    if (!data.authMethod) return true; // authMethod is optional on update
    const providerType = data.providerType; // may be undefined on update — service layer validates against stored value
    if (!providerType) return true;
    const allowed = authMethodsByProvider[providerType];
    return allowed ? allowed.includes(data.authMethod) : false;
  },
  { message: 'authMethod is not supported for the selected providerType', path: ['authMethod'] }
);
export type UpdateVaultProviderInput = z.infer<typeof updateVaultProviderSchema>;

export const testVaultProviderSchema = z.object({
  secretPath: z.string().min(1).max(500),
});
export type TestVaultProviderInput = z.infer<typeof testVaultProviderSchema>;
