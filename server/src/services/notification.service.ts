import prisma, { NotificationType } from '../lib/prisma';
import { logger } from '../utils/logger';

export { NotificationType };

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
}

export interface PaginatedNotifications {
  data: NotificationEntry[];
  total: number;
  unreadCount: number;
}

export async function createNotification(
  input: CreateNotificationInput
): Promise<NotificationEntry> {
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
  return notification;
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
