import type { FileInfo } from './files.api';
import {
  deleteRdpHistoryItem,
  deleteSshHistoryItem,
  downloadRdpHistoryItem,
  downloadSshHistoryItem,
  listRdpHistory,
  listSshHistory,
  restoreRdpHistoryItem,
  restoreSshHistoryItem,
  type ManagedHistoryEntry,
  type ManagedHistoryMutationResult,
} from './managedHistory.api';
import type { SshFileCredentials } from './sshFiles.api';

export type ManagedTransferProtocol = 'rdp' | 'ssh';

export type ManagedTransferScope =
  | { protocol: 'rdp'; connectionId: string }
  | { protocol: 'ssh'; credentials: SshFileCredentials };

export interface ManagedRestoreResult extends ManagedHistoryMutationResult {
  files?: FileInfo[];
}

export type { ManagedHistoryEntry };

export function rdpManagedTransferScope(connectionId: string): ManagedTransferScope {
  return { protocol: 'rdp', connectionId };
}

export function sshManagedTransferScope(credentials: SshFileCredentials): ManagedTransferScope {
  return { protocol: 'ssh', credentials };
}

export async function listManagedHistory(scope: ManagedTransferScope): Promise<ManagedHistoryEntry[]> {
  if (scope.protocol === 'rdp') {
    return listRdpHistory(scope.connectionId);
  }
  return listSshHistory(scope.credentials);
}

export async function downloadManagedHistoryItem(scope: ManagedTransferScope, id: string): Promise<Blob> {
  if (scope.protocol === 'rdp') {
    return downloadRdpHistoryItem(scope.connectionId, id);
  }
  return downloadSshHistoryItem({ ...scope.credentials, id });
}

export async function restoreManagedHistoryItem(
  scope: ManagedTransferScope,
  id: string,
  destinationPath?: string,
): Promise<ManagedRestoreResult> {
  if (scope.protocol === 'rdp') {
    return restoreRdpHistoryItem(scope.connectionId, id, destinationPath);
  }
  return restoreSshHistoryItem({ ...scope.credentials, id, path: destinationPath ?? '' });
}

export async function deleteManagedHistoryItem(
  scope: ManagedTransferScope,
  id: string,
): Promise<ManagedHistoryMutationResult> {
  if (scope.protocol === 'rdp') {
    return deleteRdpHistoryItem(scope.connectionId, id);
  }
  return deleteSshHistoryItem({ ...scope.credentials, id });
}
