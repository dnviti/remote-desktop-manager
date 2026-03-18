import prisma, { NotificationType, Prisma } from '../lib/prisma';
import { logger } from '../utils/logger';
import { shouldDeliver } from './notificationPreference.service';
import { sendEmail } from './email';
import { buildNotificationEmail } from './email/templates/notification';

export { NotificationType };

/** Notification types that always bypass DND / quiet hours. */
export const SECURITY_CRITICAL_TYPES = new Set<NotificationType>([
  NotificationType.IMPOSSIBLE_TRAVEL_DETECTED,
]);

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  message: string;
  relatedId?: string;
}

export interface NotificationEntry {
  id: string;
  type: NotificationType;
  message: string;
  read: boolean;
  relatedId: string | null;
  createdAt: Date;
  /** When `true`, real-time delivery (Socket.IO push) was suppressed by DND / quiet hours. */
  suppressedByQuietHours?: boolean;
}

export interface PaginatedNotifications {
  data: NotificationEntry[];
  total: number;
  unreadCount: number;
}

// ---------------------------------------------------------------------------
// DND / Quiet Hours
// ---------------------------------------------------------------------------

export interface NotificationSchedule {
  dndEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  quietHoursTimezone: string | null;
}

/**
 * Parse an "HH:mm" string to total minutes since midnight.
 * Returns `null` for invalid input.
 */
function parseHHmm(value: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Get the current minutes since midnight in a given IANA timezone.
 * Falls back to UTC if the timezone is invalid.
 */
function currentMinutesInTz(tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(new Date());

    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    return hour * 60 + minute;
  } catch {
    // Invalid timezone — fall back to UTC
    const now = new Date();
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}

/**
 * Determine whether real-time delivery should be suppressed for a user.
 * Returns `true` if the user is currently in DND or within their quiet hours window.
 * Security-critical notification types are never suppressed — callers should check
 * `SECURITY_CRITICAL_TYPES` before calling this.
 */
export async function isInQuietHours(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      notifDndEnabled: true,
      notifQuietHoursStart: true,
      notifQuietHoursEnd: true,
      notifQuietHoursTimezone: true,
    },
  });
  if (!user) return false;

  // Manual DND toggle
  if (user.notifDndEnabled) return true;

  // Quiet hours window
  if (!user.notifQuietHoursStart || !user.notifQuietHoursEnd) return false;

  const start = parseHHmm(user.notifQuietHoursStart);
  const end = parseHHmm(user.notifQuietHoursEnd);
  if (start === null || end === null) return false;

  const tz = user.notifQuietHoursTimezone || 'UTC';
  const now = currentMinutesInTz(tz);

  // Same-day window: e.g. 09:00–17:00
  if (start <= end) {
    return now >= start && now < end;
  }

  // Overnight window: e.g. 22:00–08:00 (start > end)
  return now >= start || now < end;
}

/**
 * Whether real-time delivery (Socket.IO + email) should be suppressed for this
 * specific notification, taking into account security-critical bypass.
 */
async function shouldSuppressRealtime(userId: string, type: NotificationType): Promise<boolean> {
  if (SECURITY_CRITICAL_TYPES.has(type)) return false;
  return isInQuietHours(userId);
}

export async function getNotificationSchedule(userId: string): Promise<NotificationSchedule> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      notifDndEnabled: true,
      notifQuietHoursStart: true,
      notifQuietHoursEnd: true,
      notifQuietHoursTimezone: true,
    },
  });
  if (!user) {
    return { dndEnabled: false, quietHoursStart: null, quietHoursEnd: null, quietHoursTimezone: null };
  }
  return {
    dndEnabled: user.notifDndEnabled,
    quietHoursStart: user.notifQuietHoursStart,
    quietHoursEnd: user.notifQuietHoursEnd,
    quietHoursTimezone: user.notifQuietHoursTimezone,
  };
}

export async function updateNotificationSchedule(
  userId: string,
  data: Partial<NotificationSchedule>,
): Promise<NotificationSchedule> {
  const updateData: Prisma.UserUpdateInput = {};
  if (data.dndEnabled !== undefined) updateData.notifDndEnabled = data.dndEnabled;
  if (data.quietHoursStart !== undefined) updateData.notifQuietHoursStart = data.quietHoursStart;
  if (data.quietHoursEnd !== undefined) updateData.notifQuietHoursEnd = data.quietHoursEnd;
  if (data.quietHoursTimezone !== undefined) updateData.notifQuietHoursTimezone = data.quietHoursTimezone;

  const user = await prisma.user.update({
    where: { id: userId },
    data: updateData,
    select: {
      notifDndEnabled: true,
      notifQuietHoursStart: true,
      notifQuietHoursEnd: true,
      notifQuietHoursTimezone: true,
    },
  });

  return {
    dndEnabled: user.notifDndEnabled,
    quietHoursStart: user.notifQuietHoursStart,
    quietHoursEnd: user.notifQuietHoursEnd,
    quietHoursTimezone: user.notifQuietHoursTimezone,
  };
}

// Simple in-memory rate limiter: max 10 emails per userId+type per hour.
const emailRateMap = new Map<string, { count: number; windowStart: number }>();
const EMAIL_RATE_LIMIT = 10;
const EMAIL_RATE_WINDOW_MS = 60 * 60 * 1000;

function checkEmailRateLimit(userId: string, type: NotificationType): boolean {
  const key = `${userId}:${type}`;
  const now = Date.now();
  const entry = emailRateMap.get(key);

  if (!entry || now - entry.windowStart > EMAIL_RATE_WINDOW_MS) {
    emailRateMap.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= EMAIL_RATE_LIMIT) return false;

  entry.count++;
  return true;
}

async function dispatchEmail(input: CreateNotificationInput): Promise<void> {
  try {
    const emailEnabled = await shouldDeliver(input.userId, input.type, 'email');
    if (!emailEnabled) return;

    if (!checkEmailRateLimit(input.userId, input.type)) {
      logger.warn(`Email rate limit reached for user=${input.userId} type=${input.type}`);
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { email: true },
    });
    if (!user) return;

    const { subject, html, text } = buildNotificationEmail(input.type, input.message);
    await sendEmail({ to: user.email, subject, html, text });
  } catch (err) {
    logger.error('Failed to dispatch notification email:', err);
  }
}

export async function createNotification(
  input: CreateNotificationInput
): Promise<NotificationEntry> {
  const inAppEnabled = await shouldDeliver(input.userId, input.type, 'inApp');

  // Check whether real-time delivery should be suppressed (DND / quiet hours).
  const suppressed = await shouldSuppressRealtime(input.userId, input.type);

  if (!inAppEnabled) {
    // Still dispatch email even if in-app is disabled — unless quiet hours active
    if (!suppressed) {
      dispatchEmail(input).catch((err) => logger.error('Email dispatch error:', err));
    }
    // Return a synthetic object so callers don't break
    return {
      id: '',
      type: input.type,
      message: input.message,
      read: false,
      relatedId: input.relatedId ?? null,
      createdAt: new Date(),
      suppressedByQuietHours: suppressed,
    };
  }

  // Always persist to DB — even during quiet hours the user can read later
  const notification = await prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      message: input.message,
      relatedId: input.relatedId ?? null,
    },
    select: {
      id: true,
      type: true,
      message: true,
      read: true,
      relatedId: true,
      createdAt: true,
    },
  });

  // Fire-and-forget email dispatch — suppressed during quiet hours
  if (!suppressed) {
    dispatchEmail(input).catch((err) => logger.error('Email dispatch error:', err));
  }

  return { ...notification, suppressedByQuietHours: suppressed };
}

/**
 * Fire-and-forget variant — used from sharing service where we don't want to block.
 */
export function createNotificationAsync(input: CreateNotificationInput): void {
  createNotification(input).catch((err) => {
    logger.error('Failed to create notification:', err);
  });
}

export async function listNotifications(
  userId: string,
  limit = 50,
  offset = 0
): Promise<PaginatedNotifications> {
  const safeLimit = Math.min(limit, 100);

  const [data, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: safeLimit,
      select: {
        id: true,
        type: true,
        message: true,
        read: true,
        relatedId: true,
        createdAt: true,
      },
    }),
    prisma.notification.count({ where: { userId } }),
    prisma.notification.count({ where: { userId, read: false } }),
  ]);

  return { data, total, unreadCount };
}

export async function markAsRead(notificationId: string, userId: string) {
  return prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { read: true },
  });
}

export async function markAllAsRead(userId: string) {
  return prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });
}

export async function deleteNotification(notificationId: string, userId: string) {
  return prisma.notification.deleteMany({
    where: { id: notificationId, userId },
  });
}
