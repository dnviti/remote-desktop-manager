/**
 * Connection API wrappers for the browser extension.
 *
 * All calls are routed through the background service worker via apiRequest().
 */

import { apiRequest } from './apiClient';
import type { BackgroundResponse } from '../types';

/** Connection type — matches the server/client model. */
export type ConnectionType = 'RDP' | 'SSH' | 'VNC';

/** Connection data returned by GET /api/connections. */
export interface ExtensionConnection {
  id: string;
  name: string;
  type: ConnectionType;
  host: string;
  port: number;
  folderId: string | null;
  teamId?: string | null;
  teamName?: string | null;
  scope?: 'private' | 'team' | 'shared';
  credentialSecretId?: string | null;
  credentialSecretName?: string | null;
  description: string | null;
  isFavorite: boolean;
  isOwner: boolean;
  permission?: string;
  sharedBy?: string;
  createdAt: string;
  updatedAt: string;
}

/** Shape of the /api/connections response. */
export interface ConnectionsResponse {
  own: ExtensionConnection[];
  shared: ExtensionConnection[];
  team: ExtensionConnection[];
}

/**
 * Fetch all connections for the active account.
 */
export function listConnections(
  accountId: string,
): Promise<BackgroundResponse<ConnectionsResponse>> {
  return apiRequest<ConnectionsResponse>(accountId, 'GET', '/api/connections');
}

/**
 * Toggle favorite status for a connection.
 */
export function toggleFavorite(
  accountId: string,
  connectionId: string,
): Promise<BackgroundResponse<{ id: string; isFavorite: boolean }>> {
  return apiRequest<{ id: string; isFavorite: boolean }>(
    accountId,
    'PATCH',
    `/api/connections/${connectionId}/favorite`,
  );
}
