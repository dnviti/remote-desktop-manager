import api from './client';

export interface SyncProfileData {
  id: string;
  name: string;
  provider: 'NETBOX';
  config: {
    url: string;
    filters: Record<string, string>;
    platformMapping: Record<string, string>;
    defaultProtocol: string;
    defaultPort: Record<string, number>;
    conflictStrategy: 'update' | 'skip' | 'overwrite';
  };
  cronExpression: string | null;
  enabled: boolean;
  teamId: string | null;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncDetails: Record<string, unknown> | null;
  hasApiToken: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SyncLogEntry {
  id: string;
  syncProfileId: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  details: Record<string, unknown> | null;
  triggeredBy: string;
}

export interface DiscoveredDeviceData {
  externalId: string;
  name: string;
  host: string;
  port: number;
  protocol: string;
  siteName?: string;
  rackName?: string;
  description?: string;
}

export interface SyncPlanData {
  toCreate: DiscoveredDeviceData[];
  toUpdate: Array<{ device: DiscoveredDeviceData; connectionId: string; changes: string[] }>;
  toSkip: Array<{ device: DiscoveredDeviceData; reason: string }>;
  errors: Array<{ device: DiscoveredDeviceData; error: string }>;
}

export interface SyncResultData {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ externalId: string; name: string; error: string }>;
}

export interface CreateSyncProfileInput {
  name: string;
  provider: 'NETBOX';
  url: string;
  apiToken: string;
  filters?: Record<string, string>;
  platformMapping?: Record<string, string>;
  defaultProtocol?: string;
  defaultPort?: Record<string, number>;
  conflictStrategy?: string;
  cronExpression?: string;
  teamId?: string;
}

export interface UpdateSyncProfileInput {
  name?: string;
  url?: string;
  apiToken?: string;
  filters?: Record<string, string>;
  platformMapping?: Record<string, string>;
  defaultProtocol?: string;
  defaultPort?: Record<string, number>;
  conflictStrategy?: string;
  cronExpression?: string | null;
  enabled?: boolean;
  teamId?: string | null;
}

export async function listSyncProfiles(): Promise<SyncProfileData[]> {
  const { data } = await api.get<SyncProfileData[]>('/sync-profiles');
  return data;
}

export async function createSyncProfile(input: CreateSyncProfileInput): Promise<SyncProfileData> {
  const { data } = await api.post<SyncProfileData>('/sync-profiles', input);
  return data;
}

export async function updateSyncProfile(id: string, input: UpdateSyncProfileInput): Promise<SyncProfileData> {
  const { data } = await api.put<SyncProfileData>(`/sync-profiles/${id}`, input);
  return data;
}

export async function deleteSyncProfile(id: string): Promise<void> {
  await api.delete(`/sync-profiles/${id}`);
}

export async function testSyncConnection(id: string): Promise<{ ok: boolean; error?: string }> {
  const { data } = await api.post<{ ok: boolean; error?: string }>(`/sync-profiles/${id}/test`);
  return data;
}

export async function triggerSync(id: string, dryRun: boolean): Promise<{ plan: SyncPlanData; result?: SyncResultData }> {
  const { data } = await api.post<{ plan: SyncPlanData; result?: SyncResultData }>(`/sync-profiles/${id}/sync`, { dryRun });
  return data;
}

export async function getSyncLogs(id: string, page = 1, limit = 20): Promise<{ logs: SyncLogEntry[]; total: number }> {
  const { data } = await api.get<{ logs: SyncLogEntry[]; total: number }>(`/sync-profiles/${id}/logs`, {
    params: { page, limit },
  });
  return data;
}
