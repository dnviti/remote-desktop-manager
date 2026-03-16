/**
 * Secrets API wrappers for the browser extension.
 *
 * All calls route through the background service worker via apiRequest().
 * Decrypted secret data is NEVER persisted in chrome.storage — only held
 * in component state within the popup.
 */

import { apiRequest } from './apiClient';
import type {
  BackgroundResponse,
  SecretListItem,
  SecretDetail,
  SecretListFilters,
} from '../types';

/** List secrets with optional filters. */
export function listSecrets(
  accountId: string,
  filters?: SecretListFilters,
): Promise<BackgroundResponse<SecretListItem[]>> {
  const params = new URLSearchParams();
  if (filters?.scope) params.set('scope', filters.scope);
  if (filters?.type) params.set('type', filters.type);
  if (filters?.folderId !== undefined && filters.folderId !== null) params.set('folderId', filters.folderId);
  if (filters?.search) params.set('search', filters.search);
  if (filters?.isFavorite !== undefined) params.set('isFavorite', String(filters.isFavorite));
  if (filters?.tags?.length) params.set('tags', filters.tags.join(','));

  const query = params.toString();
  const path = query ? `/api/secrets?${query}` : '/api/secrets';
  return apiRequest<SecretListItem[]>(accountId, 'GET', path);
}

/** Get a single secret with decrypted data. */
export function getSecret(
  accountId: string,
  secretId: string,
): Promise<BackgroundResponse<SecretDetail>> {
  return apiRequest<SecretDetail>(accountId, 'GET', `/api/secrets/${secretId}`);
}
