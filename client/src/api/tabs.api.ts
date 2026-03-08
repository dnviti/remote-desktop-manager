import api from './client';

export interface PersistedTab {
  connectionId: string;
  sortOrder: number;
  isActive: boolean;
}

export async function getPersistedTabs(): Promise<PersistedTab[]> {
  const res = await api.get('/tabs');
  return res.data;
}

export async function syncPersistedTabs(tabs: PersistedTab[]): Promise<PersistedTab[]> {
  const res = await api.put('/tabs', { tabs });
  return res.data;
}

export async function clearPersistedTabs(): Promise<void> {
  await api.delete('/tabs');
}
