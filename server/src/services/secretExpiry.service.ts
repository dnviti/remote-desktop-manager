import prisma from '../lib/prisma';
import type { NotificationType } from './notification.service';
import { emitNotification } from '../socket/notification.handler';
import { logger } from '../utils/logger';

const DEDUP_HOURS = 24;

interface ExpiryBand {
  type: NotificationType;
  label: string;
  maxDays: number;
}

const EXPIRY_BANDS: ExpiryBand[] = [
  { type: 'SECRET_EXPIRED', label: 'has expired', maxDays: 0 },
  { type: 'SECRET_EXPIRING', label: 'expires in 1 day', maxDays: 1 },
  { type: 'SECRET_EXPIRING', label: 'expires in 7 days', maxDays: 7 },
  { type: 'SECRET_EXPIRING', label: 'expires in 30 days', maxDays: 30 },
];

function getBand(daysUntilExpiry: number): ExpiryBand | null {
  if (daysUntilExpiry <= 0) return EXPIRY_BANDS[0];
  if (daysUntilExpiry <= 1) return EXPIRY_BANDS[1];
  if (daysUntilExpiry <= 7) return EXPIRY_BANDS[2];
  if (daysUntilExpiry <= 30) return EXPIRY_BANDS[3];
  return null;
}

async function getRecipientUserIds(secret: {
  scope: string;
  userId: string;
  teamId: string | null;
  tenantId: string | null;
}): Promise<string[]> {
  if (secret.scope === 'PERSONAL') {
    return [secret.userId];
  }

  if (secret.scope === 'TEAM' && secret.teamId) {
    const admins = await prisma.teamMember.findMany({
      where: { teamId: secret.teamId, role: 'TEAM_ADMIN' },
      select: { userId: true },
    });
    return admins.length > 0 ? admins.map((a) => a.userId) : [secret.userId];
  }

  if (secret.scope === 'TENANT' && secret.tenantId) {
    const admins = await prisma.tenantMember.findMany({
      where: {
        tenantId: secret.tenantId,
        role: { in: ['OWNER', 'ADMIN'] },
      },
      select: { userId: true },
    });
    return admins.length > 0 ? admins.map((a) => a.userId) : [secret.userId];
  }

  return [secret.userId];
}

async function hasRecentNotification(
  userId: string,
  relatedId: string,
  type: NotificationType
): Promise<boolean> {
  const cutoff = new Date(Date.now() - DEDUP_HOURS * 60 * 60 * 1000);
  const existing = await prisma.notification.findFirst({
    where: {
      userId,
      type,
      relatedId,
      createdAt: { gte: cutoff },
    },
    select: { id: true },
  });
  return existing !== null;
}

export async function checkExpiringSecrets(): Promise<number> {
  const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const secrets = await prisma.vaultSecret.findMany({
    where: {
      expiresAt: { not: null, lte: thirtyDaysFromNow },
    },
    select: {
      id: true,
      name: true,
      scope: true,
      userId: true,
      teamId: true,
      tenantId: true,
      expiresAt: true,
    },
  });

  let notificationCount = 0;

  for (const secret of secrets) {
    const daysUntilExpiry = Math.ceil(
      ((secret.expiresAt as Date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    const band = getBand(daysUntilExpiry);
    if (!band) continue;

    const recipientIds = await getRecipientUserIds(secret);

    for (const userId of recipientIds) {
      const isDuplicate = await hasRecentNotification(userId, secret.id, band.type);
      if (isDuplicate) continue;

      const message =
        daysUntilExpiry <= 0
          ? `Secret '${secret.name}' has expired`
          : `Secret '${secret.name}' expires in ${daysUntilExpiry} day(s)`;

      const notification = await prisma.notification.create({
        data: {
          userId,
          type: band.type,
          message,
          relatedId: secret.id,
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

      emitNotification(userId, notification);
      notificationCount++;
    }
  }

  if (notificationCount > 0) {
    logger.info(`Secret expiry check: sent ${notificationCount} notification(s)`);
  }

  return notificationCount;
}
