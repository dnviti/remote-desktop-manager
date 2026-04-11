import type { Dispatch, SetStateAction } from 'react';
import type { CredentialOverride } from '../../store/tabsStore';
import type { SshFileCredentials } from '../../api/sshFiles.api';
import type { TransferItem } from '../../hooks/useSftpTransfers';

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 86400000) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

export function normalizeCredentials(connectionId: string, credentials?: CredentialOverride): SshFileCredentials {
  return {
    connectionId,
    ...(credentials?.credentialMode === 'domain'
      ? { credentialMode: 'domain' as const }
      : credentials && {
          username: credentials.username,
          password: credentials.password,
          ...(credentials.domain ? { domain: credentials.domain } : {}),
          ...(credentials.credentialMode ? { credentialMode: credentials.credentialMode } : {}),
        }),
  };
}

export function updateTransfer(
  setter: Dispatch<SetStateAction<TransferItem[]>>,
  transferId: string,
  patch: Partial<TransferItem>,
) {
  setter((prev) => prev.map((transfer) => (transfer.transferId === transferId ? { ...transfer, ...patch } : transfer)));
}

export function joinRemotePath(currentPath: string, name: string): string {
  return currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
}

export function triggerBlobDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
