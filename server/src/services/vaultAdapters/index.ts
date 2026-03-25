/**
 * Vault adapter registry — maps ExternalVaultType to adapter instance.
 */

import type { VaultAdapter } from './types';
import { hashicorpAdapter, invalidateHashicorpCaches } from './hashicorp.adapter';
import { awsAdapter, invalidateAwsCaches } from './aws.adapter';
import { azureAdapter, invalidateAzureCaches } from './azure.adapter';
import { gcpAdapter, invalidateGcpCaches } from './gcp.adapter';
import { conjurAdapter, invalidateConjurCaches } from './conjur.adapter';

export type { VaultAdapter, VaultProviderRow } from './types';
export { toResolvedCredentials } from './types';

const adapters: Record<string, VaultAdapter> = {
  HASHICORP_VAULT: hashicorpAdapter,
  AWS_SECRETS_MANAGER: awsAdapter,
  AZURE_KEY_VAULT: azureAdapter,
  GCP_SECRET_MANAGER: gcpAdapter,
  CYBERARK_CONJUR: conjurAdapter,
};

/** Get the adapter for a given provider type. Throws if unknown. */
export function getAdapter(providerType: string): VaultAdapter {
  const adapter = adapters[providerType];
  if (!adapter) {
    throw new Error(`Unsupported vault provider type: ${providerType}`);
  }
  return adapter;
}

/** Invalidate all caches for a provider (called on update/delete). */
export function invalidateCaches(providerType: string, providerId: string): void {
  switch (providerType) {
    case 'HASHICORP_VAULT': invalidateHashicorpCaches(providerId); break;
    case 'AWS_SECRETS_MANAGER': invalidateAwsCaches(providerId); break;
    case 'AZURE_KEY_VAULT': invalidateAzureCaches(providerId); break;
    case 'GCP_SECRET_MANAGER': invalidateGcpCaches(providerId); break;
    case 'CYBERARK_CONJUR': invalidateConjurCaches(providerId); break;
    default: break;
  }
}

/** All supported provider types for validation. */
export const SUPPORTED_PROVIDER_TYPES = Object.keys(adapters);

/** Auth methods allowed per provider type. */
export const AUTH_METHODS_BY_PROVIDER: Record<string, string[]> = {
  HASHICORP_VAULT: ['TOKEN', 'APPROLE'],
  AWS_SECRETS_MANAGER: ['IAM_ACCESS_KEY', 'IAM_ROLE'],
  AZURE_KEY_VAULT: ['CLIENT_CREDENTIALS', 'MANAGED_IDENTITY'],
  GCP_SECRET_MANAGER: ['SERVICE_ACCOUNT_KEY', 'WORKLOAD_IDENTITY'],
  CYBERARK_CONJUR: ['CONJUR_API_KEY', 'CONJUR_AUTHN_K8S'],
};
