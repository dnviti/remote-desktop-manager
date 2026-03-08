const STORAGE_KEY_PREFIX = 'arsenale-recent-connections-';
const MAX_RECENT = 10;

interface RecentEntry {
  connectionId: string;
  openedAt: number;
}

function getStorageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

export function getRecentConnectionIds(userId: string): string[] {
  try {
    const raw = localStorage.getItem(getStorageKey(userId));
    if (!raw) return [];
    const entries: RecentEntry[] = JSON.parse(raw);
    return entries.map((e) => e.connectionId);
  } catch {
    return [];
  }
}

export function addRecentConnection(userId: string, connectionId: string): void {
  try {
    const key = getStorageKey(userId);
    const raw = localStorage.getItem(key);
    let entries: RecentEntry[] = raw ? JSON.parse(raw) : [];
    entries = entries.filter((e) => e.connectionId !== connectionId);
    entries.unshift({ connectionId, openedAt: Date.now() });
    entries = entries.slice(0, MAX_RECENT);
    localStorage.setItem(key, JSON.stringify(entries));
  } catch {
    // localStorage may be full or unavailable
  }
}
