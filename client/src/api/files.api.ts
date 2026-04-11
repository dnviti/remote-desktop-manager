import api from './client';

export interface FileInfo {
  name: string;
  size: number;
  modifiedAt: string;
}

export async function listFiles(connectionId: string): Promise<FileInfo[]> {
  const { data } = await api.get('/files', {
    params: { connectionId },
  });
  return data;
}

export async function uploadFile(connectionId: string, file: File): Promise<FileInfo[]> {
  const formData = new FormData();
  formData.append('connectionId', connectionId);
  formData.append('file', file);
  const { data } = await api.post('/files', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

export async function downloadFile(connectionId: string, name: string): Promise<void> {
  const { data } = await api.get(`/files/${encodeURIComponent(name)}`, {
    params: { connectionId },
    responseType: 'blob',
  });
  const url = window.URL.createObjectURL(new Blob([data]));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', name);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export async function deleteFile(connectionId: string, name: string): Promise<void> {
  await api.delete(`/files/${encodeURIComponent(name)}`, {
    params: { connectionId },
  });
}
