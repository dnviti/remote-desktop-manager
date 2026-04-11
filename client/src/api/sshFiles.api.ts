import type { AxiosProgressEvent } from 'axios';
import api from './client';

export interface SshFileCredentials {
  connectionId: string;
  username?: string;
  password?: string;
  domain?: string;
  credentialMode?: 'saved' | 'domain' | 'manual';
}

export interface SshFileEntry {
  name: string;
  size: number;
  type: 'file' | 'directory' | 'symlink';
  modifiedAt: string;
}

export interface SshListResponse {
  entries: SshFileEntry[];
}

export interface SshFileProgressOptions {
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}

export async function listSshFiles(payload: SshFileCredentials & { path: string }, signal?: AbortSignal): Promise<SshListResponse> {
  const { data } = await api.post('/files/ssh/list', payload, { signal });
  return data;
}

export async function createSshDirectory(payload: SshFileCredentials & { path: string }): Promise<void> {
  await api.post('/files/ssh/mkdir', payload);
}

export async function deleteSshPath(payload: SshFileCredentials & { path: string }): Promise<void> {
  await api.post('/files/ssh/delete', payload);
}

export async function renameSshPath(payload: SshFileCredentials & { oldPath: string; newPath: string }): Promise<void> {
  await api.post('/files/ssh/rename', payload);
}

export async function uploadSshFile(
  payload: SshFileCredentials & { remotePath: string; file: File },
  options?: SshFileProgressOptions,
): Promise<void> {
  const formData = new FormData();
  formData.append('connectionId', payload.connectionId);
  formData.append('remotePath', payload.remotePath);
  formData.append('file', payload.file);
  if (payload.username) formData.append('username', payload.username);
  if (payload.password) formData.append('password', payload.password);
  if (payload.domain) formData.append('domain', payload.domain);
  if (payload.credentialMode) formData.append('credentialMode', payload.credentialMode);

  await api.post('/files/ssh/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    signal: options?.signal,
    onUploadProgress: (event: AxiosProgressEvent) => {
      options?.onProgress?.(event.loaded, event.total ?? payload.file.size);
    },
  });
}

export async function downloadSshFile(
  payload: SshFileCredentials & { path: string },
  options?: SshFileProgressOptions,
): Promise<Blob> {
  const { data } = await api.post('/files/ssh/download', payload, {
    responseType: 'blob',
    signal: options?.signal,
    onDownloadProgress: (event: AxiosProgressEvent) => {
      options?.onProgress?.(event.loaded, event.total ?? 0);
    },
  });
  return new Blob([data]);
}
