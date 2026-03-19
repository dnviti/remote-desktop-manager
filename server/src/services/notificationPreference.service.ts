import prisma, { NotificationType } from '../lib/prisma';

export { NotificationType };

export interface NotificationPreferenceEntry {
  type: NotificationType;
  inApp: boolean;
  email: boolean;
}

// Security-critical types default to email=true
const EMAIL_DEFAULT_TRUE = new Set<NotificationType>([
  NotificationType.IMPOSSIBLE_TRAVEL_DETECTED,
  NotificationType.LATERAL_MOVEMENT_ALERT,
  NotificationType.SECRET_EXPIRING,
]);

const ALL_TYPES = Object.values(NotificationType) as NotificationType[];

function buildDefault(type: NotificationType): NotificationPreferenceEntry {
  return {
    type,
    inApp: true,
    email: EMAIL_DEFAULT_TRUE.has(type),
  };
}

export async function getPreferences(userId: string): Promise<NotificationPreferenceEntry[]> {
  const stored = await prisma.notificationPreference.findMany({
    where: { userId },
    select: { type: true, inApp: true, email: true },
  });

  const storedMap = new Map(stored.map((p) => [p.type, p]));

  return ALL_TYPES.map((type) => storedMap.get(type) ?? buildDefault(type));
}

export async function upsertPreference(
  userId: string,
  type: NotificationType,
  data: { inApp?: boolean; email?: boolean }
): Promise<NotificationPreferenceEntry> {
  const defaults = buildDefault(type);
  const pref = await prisma.notificationPreference.upsert({
    where: { userId_type: { userId, type } },
    create: {
      userId,
      type,
      inApp: data.inApp ?? defaults.inApp,
      email: data.email ?? defaults.email,
    },
    update: {
      ...(data.inApp !== undefined && { inApp: data.inApp }),
      ...(data.email !== undefined && { email: data.email }),
    },
    select: { type: true, inApp: true, email: true },
  });
  return pref;
}

export async function bulkUpsertPreferences(
  userId: string,
  preferences: Array<{ type: NotificationType; inApp?: boolean; email?: boolean }>
): Promise<NotificationPreferenceEntry[]> {
  const results = await Promise.all(
    preferences.map((p) => upsertPreference(userId, p.type, { inApp: p.inApp, email: p.email }))
  );
  return results;
}

// Cache for shouldDeliver to avoid a DB hit on every notification.
// TTL: 60 seconds. Keys: `${userId}:${type}:${channel}`
const deliveryCache = new Map<string, { value: boolean; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

export async function shouldDeliver(
  userId: string,
  type: NotificationType,
  channel: 'inApp' | 'email'
): Promise<boolean> {
  const key = `${userId}:${type}:${channel}`;
  const cached = deliveryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const pref = await prisma.notificationPreference.findUnique({
    where: { userId_type: { userId, type } },
    select: { inApp: true, email: true },
  });

  const value = pref ? pref[channel] : buildDefault(type)[channel];
  deliveryCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

/** Invalidate cached delivery decisions for a user (call after preference update). */
export function invalidateDeliveryCache(userId: string): void {
  for (const key of deliveryCache.keys()) {
    if (key.startsWith(`${userId}:`)) deliveryCache.delete(key);
  }
}
