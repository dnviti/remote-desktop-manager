/**
 * Common interface and types for external vault provider adapters.
 *
 * Every adapter must implement `VaultAdapter` so the service layer can
 * dispatch secret operations without knowing the underlying backend.
 */

import type { ResolvedCredentials } from '../../types';
import { AppError } from '../../middleware/error.middleware';

// ---------- Provider row shape expected by adapters ----------

/** Subset of ExternalVaultProvider columns that adapters need. */
export interface VaultProviderRow {
  id: string;
  serverUrl: string;
  authMethod: string;
  namespace: string | null;
  mountPath: string;
  encryptedAuthPayload: string;
  authPayloadIV: string;
  authPayloadTag: string;
  caCertificate: string | null;
  cacheTtlSeconds: number;
}

// ---------- Adapter interface ----------

export interface VaultAdapter {
  /**
   * Read a secret from the backend and return the raw key/value data.
   * Implementations handle auth, caching, and response parsing internally.
   */
  readSecret(provider: VaultProviderRow, secretPath: string): Promise<Record<string, string>>;

  /**
   * Test whether the backend is reachable and the secret path is valid.
   * Returns the list of field names found in the secret.
   */
  testConnection(provider: VaultProviderRow, secretPath: string): Promise<{ success: boolean; keys?: string[]; error?: string }>;
}

// ---------- Shared helpers ----------

/**
 * Map raw secret data to the standard ResolvedCredentials shape.
 * Accepts common field-name variants across all backends.
 */
export function toResolvedCredentials(data: Record<string, string>, secretPath: string): ResolvedCredentials {
  const username = data.username ?? data.user ?? '';
  const password = data.password ?? data.pass ?? '';
  if (!username && !password) {
    throw new AppError(`Secret at "${secretPath}" does not contain username/password fields`, 502);
  }
  return {
    username,
    password,
    domain: data.domain,
    privateKey: data.private_key ?? data.privateKey,
    passphrase: data.passphrase,
  };
}
