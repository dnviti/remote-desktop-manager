import api from './client';

export interface ExportRequest {
  format: 'CSV' | 'JSON';
  includeCredentials?: boolean;
  connectionIds?: string[];
  folderId?: string;
}

export interface ImportOptions {
  duplicateStrategy: 'SKIP' | 'OVERWRITE' | 'RENAME';
  columnMapping?: Record<string, string>;
  format?: 'CSV' | 'JSON' | 'MREMOTENG' | 'RDP';
}

export interface ImportResult {
  imported: number;
  skipped: number;
  failed: number;
  errors: Array<{ row?: number; filename: string; error: string }>;
}

export async function exportConnections(data: ExportRequest): Promise<Blob> {
  const response = await api.post('/connections/export', data, {
    responseType: 'blob',
  });
  return response.data;
}

export async function importConnections(
  file: File,
  options: ImportOptions
): Promise<ImportResult> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('duplicateStrategy', options.duplicateStrategy);
  if (options.format) {
    formData.append('format', options.format);
  }
  if (options.columnMapping) {
    formData.append('columnMapping', JSON.stringify(options.columnMapping));
  }

  const response = await api.post('/connections/import', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
}

export async function downloadExport(data: ExportRequest, filename: string): Promise<void> {
  const blob = await exportConnections(data);
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}
