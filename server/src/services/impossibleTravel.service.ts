import prisma, { AuditAction } from '../lib/prisma';
import { config } from '../config';
import { logger } from '../utils/logger';
import * as notificationService from './notification.service';

const AUTH_ACTIONS: AuditAction[] = [
  'LOGIN',
  'LOGIN_OAUTH',
  'LOGIN_TOTP',
  'LOGIN_SMS',
  'LOGIN_WEBAUTHN',
  'LDAP_LOGIN',
];

const EARTH_RADIUS_KM = 6_371;

/**
 * Haversine distance between two [lat, lng] coordinate pairs.
 * Returns distance in kilometres.
 */
function haversineDistanceKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Fire-and-forget impossible travel check.
 * Called after an auth-related audit log entry is written.
 *
 * Logic:
 *  1. Find the user's previous auth event that has geo coordinates.
 *  2. Calculate the Haversine distance between the two events.
 *  3. Derive the required speed (distance / time).
 *  4. If speed exceeds the configurable threshold, flag the entry and notify tenant admins.
 */
async function resolveSpeedThreshold(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      tenantMemberships: {
        where: { isActive: true },
        take: 1,
        include: { tenant: { select: { impossibleTravelSpeedKmh: true } } },
      },
    },
  });
  return user?.tenantMemberships[0]?.tenant.impossibleTravelSpeedKmh ?? config.impossibleTravelSpeedKmh;
}

export function check(
  auditLogId: string,
  userId: string,
  action: AuditAction,
  geoCoords: number[],
  createdAt: Date,
): void {
  if (!AUTH_ACTIONS.includes(action)) return;
  if (!geoCoords || geoCoords.length < 2) return;

  doCheck(auditLogId, userId, geoCoords, createdAt).catch((err) => {
    logger.error('Impossible travel check failed:', err);
  });
}

async function doCheck(
  auditLogId: string,
  userId: string,
  currentCoords: number[],
  currentTime: Date,
): Promise<void> {
  const threshold = await resolveSpeedThreshold(userId);
  if (threshold <= 0) return;

  // Find the most recent previous auth event with geo data for this user
  const previous = await prisma.auditLog.findFirst({
    where: {
      userId,
      action: { in: AUTH_ACTIONS },
      id: { not: auditLogId },
      geoCoords: { isEmpty: false },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      geoCoords: true,
      geoCity: true,
      geoCountry: true,
      createdAt: true,
    },
  });

  if (!previous || previous.geoCoords.length < 2) return;

  const [curLat, curLng] = currentCoords;
  const [prevLat, prevLng] = previous.geoCoords;

  const distanceKm = haversineDistanceKm(prevLat, prevLng, curLat, curLng);

  // Skip trivially close locations (< 50 km — same metro area / VPN noise)
  if (distanceKm < 50) return;

  const timeDiffHours =
    (currentTime.getTime() - previous.createdAt.getTime()) / (1000 * 60 * 60);

  // Avoid division by zero for near-simultaneous events
  if (timeDiffHours < 0.001) return;

  const requiredSpeedKmh = distanceKm / timeDiffHours;

  if (requiredSpeedKmh <= threshold) return;

  // --- Impossible travel detected ---

  // Flag the current audit entry
  await prisma.auditLog.update({
    where: { id: auditLogId },
    data: { flags: { push: 'IMPOSSIBLE_TRAVEL' } },
  });

  // Also log a dedicated audit event
  const currentGeo = await prisma.auditLog.findUnique({
    where: { id: auditLogId },
    select: { geoCity: true, geoCountry: true, ipAddress: true },
  });

  const prevLocation = [previous.geoCity, previous.geoCountry].filter(Boolean).join(', ') || 'Unknown';
  const currLocation = [currentGeo?.geoCity, currentGeo?.geoCountry].filter(Boolean).join(', ') || 'Unknown';

  prisma.auditLog
    .create({
      data: {
        userId,
        action: 'IMPOSSIBLE_TRAVEL_DETECTED',
        targetType: 'User',
        targetId: userId,
        details: {
          previousLocation: prevLocation,
          currentLocation: currLocation,
          distanceKm: Math.round(distanceKm),
          timeDiffMinutes: Math.round(timeDiffHours * 60),
          requiredSpeedKmh: Math.round(requiredSpeedKmh),
          thresholdKmh: threshold,
        },
        ipAddress: currentGeo?.ipAddress ?? null,
        geoCountry: currentGeo?.geoCountry ?? null,
        geoCity: currentGeo?.geoCity ?? null,
        geoCoords: currentCoords,
        flags: ['IMPOSSIBLE_TRAVEL'],
      },
    })
    .catch((err) => logger.error('Failed to write impossible travel audit log:', err));

  // Notify tenant admins
  await notifyTenantAdmins(userId, prevLocation, currLocation, Math.round(timeDiffHours * 60), Math.round(distanceKm));
}

async function notifyTenantAdmins(
  userId: string,
  fromLocation: string,
  toLocation: string,
  timeDiffMinutes: number,
  distanceKm: number,
): Promise<void> {
  // Look up the user's info and tenant memberships
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      username: true,
      email: true,
      tenantMemberships: {
        where: { isActive: true },
        select: {
          tenant: {
            select: {
              members: {
                where: {
                  isActive: true,
                  role: { in: ['OWNER', 'ADMIN'] },
                },
                select: { userId: true },
              },
            },
          },
        },
      },
    },
  });

  if (!user) return;

  const displayName = user.username || user.email;
  const message =
    `Impossible travel detected for ${displayName}: ` +
    `${fromLocation} \u2192 ${toLocation} (${distanceKm} km in ${timeDiffMinutes} min)`;

  // Collect unique admin user IDs across all tenants
  const adminIds = new Set<string>();
  for (const membership of user.tenantMemberships) {
    for (const admin of membership.tenant.members) {
      if (admin.userId !== userId) {
        adminIds.add(admin.userId);
      }
    }
  }

  for (const adminId of adminIds) {
    notificationService.createNotificationAsync({
      userId: adminId,
      type: 'IMPOSSIBLE_TRAVEL_DETECTED',
      message,
      relatedId: userId,
    });
  }
}
