import api from './client';

export type SettingType = 'boolean' | 'number' | 'string' | 'select' | 'string[]';

export interface SettingValue {
  key: string;
  value: unknown;
  source: 'env' | 'db' | 'default';
  envLocked: boolean;
  canEdit: boolean;
  type: SettingType;
  default: unknown;
  options?: string[];
  group: string;
  label: string;
  description: string;
  restartRequired: boolean;
  sensitive: boolean;
}

export interface SettingGroup {
  key: string;
  label: string;
  order: number;
}

export interface SystemSettingsResponse {
  settings: SettingValue[];
  groups: SettingGroup[];
}

export async function getSystemSettings(): Promise<SystemSettingsResponse> {
  const { data } = await api.get<SystemSettingsResponse>('/admin/system-settings');
  return data;
}

export async function updateSystemSetting(
  key: string,
  value: unknown,
): Promise<{ key: string; value: unknown; source: 'db' }> {
  const { data } = await api.put<{ key: string; value: unknown; source: 'db' }>(
    `/admin/system-settings/${encodeURIComponent(key)}`,
    { value },
  );
  return data;
}

export interface DbStatusResponse {
  host: string;
  port: number;
  database: string;
  connected: boolean;
  version: string | null;
}

export async function getAdminDbStatus(): Promise<DbStatusResponse> {
  const { data } = await api.get<DbStatusResponse>('/admin/system-settings/db-status');
  return data;
}
