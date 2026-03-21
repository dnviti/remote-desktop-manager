/**
 * OAuth 2.0 Device Authorization Grant (RFC 8628).
 *
 * Used by the Arsenale CLI to authenticate without requiring the user
 * to type their password into a terminal. Instead the CLI displays a
 * short user code and polls for authorization while the user approves
 * the request in their browser.
 */

import crypto from 'crypto';
import prisma from '../lib/prisma';
import { logger } from '../utils/logger';
import { issueTokens } from './auth.service';
import { AppError } from '../middleware/error.middleware';

const log = logger.child('deviceAuth');

/** Length of the random device code (hex). */
const DEVICE_CODE_BYTES = 32;
/** User-facing code: 8 uppercase alphanumeric characters with a dash in the middle. */
const USER_CODE_LENGTH = 8;
/** How long before a device code expires (seconds). */
const DEVICE_CODE_TTL_SECONDS = 600; // 10 minutes
/** Minimum polling interval for token requests (seconds). */
const POLLING_INTERVAL = 5;

// Characters used for the user code (no ambiguous chars like 0/O, 1/I/L)
const USER_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function uniformRandom(max: number): number {
  const limit = 256 - (256 % max);
  let b: number;
  do { b = crypto.randomBytes(1)[0]; } while (b >= limit);
  return b % max;
}

function generateUserCode(): string {
  let code = '';
  for (let i = 0; i < USER_CODE_LENGTH; i++) {
    code += USER_CODE_CHARS[uniformRandom(USER_CODE_CHARS.length)];
  }
  // Format as XXXX-XXXX for readability
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * Step 1: CLI requests a device code.
 * Returns the device_code, user_code, verification_uri, and polling interval.
 */
export async function initiateDeviceAuth(clientUrl: string) {
  const deviceCode = crypto.randomBytes(DEVICE_CODE_BYTES).toString('hex');
  const userCode = generateUserCode();
  const expiresAt = new Date(Date.now() + DEVICE_CODE_TTL_SECONDS * 1000);

  // Retry on userCode collision (unique constraint) — extremely unlikely but handled
  const MAX_RETRIES = 3;
  let finalUserCode = userCode;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await prisma.deviceAuthCode.create({
        data: {
          deviceCode,
          userCode: finalUserCode,
          expiresAt,
          interval: POLLING_INTERVAL,
        },
      });
      break;
    } catch (err) {
      const isUniqueViolation = (err as { code?: string }).code === 'P2002';
      if (!isUniqueViolation || attempt === MAX_RETRIES - 1) throw err;
      finalUserCode = generateUserCode();
    }
  }

  log.verbose(`Device auth initiated: user_code=${finalUserCode}`);

  return {
    device_code: deviceCode,
    user_code: finalUserCode,
    verification_uri: `${clientUrl}/device`,
    verification_uri_complete: `${clientUrl}/device?code=${userCode}`,
    expires_in: DEVICE_CODE_TTL_SECONDS,
    interval: POLLING_INTERVAL,
  };
}

/**
 * Step 2: User approves the device code in their browser.
 * Called when the authenticated user enters the user_code in the web UI.
 */
export async function authorizeDevice(userId: string, userCode: string) {
  const normalizedCode = userCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
  // Re-insert the dash for lookup
  const formattedCode = normalizedCode.length === 8
    ? `${normalizedCode.slice(0, 4)}-${normalizedCode.slice(4)}`
    : userCode.toUpperCase();

  const record = await prisma.deviceAuthCode.findUnique({
    where: { userCode: formattedCode },
  });

  if (!record) {
    throw new AppError('Invalid device code', 404);
  }

  if (record.expiresAt < new Date()) {
    await prisma.deviceAuthCode.delete({ where: { id: record.id } });
    throw new AppError('Device code has expired', 410);
  }

  if (record.authorized) {
    throw new AppError('Device code already authorized', 409);
  }

  await prisma.deviceAuthCode.update({
    where: { id: record.id },
    data: { userId, authorized: true },
  });

  log.verbose(`Device auth authorized by user ${userId}: user_code=${formattedCode}`);
}

/**
 * Step 3: CLI polls for token.
 * Returns tokens once the user has approved, or an appropriate RFC 8628 error.
 */
export async function pollDeviceToken(deviceCode: string) {
  const record = await prisma.deviceAuthCode.findUnique({
    where: { deviceCode },
  });

  if (!record) {
    return { error: 'invalid_grant' as const };
  }

  if (record.expiresAt < new Date()) {
    await prisma.deviceAuthCode.delete({ where: { id: record.id } });
    return { error: 'expired_token' as const };
  }

  if (!record.authorized || !record.userId) {
    return { error: 'authorization_pending' as const };
  }

  // Authorization complete -- issue tokens and clean up
  const user = await prisma.user.findUnique({
    where: { id: record.userId },
    select: { id: true, email: true, username: true, avatarData: true },
  });

  if (!user) {
    await prisma.deviceAuthCode.delete({ where: { id: record.id } });
    return { error: 'invalid_grant' as const };
  }

  const tokens = await issueTokens(user);

  // Clean up the device code
  await prisma.deviceAuthCode.delete({ where: { id: record.id } });

  log.verbose(`Device auth token issued for user ${user.id}`);

  return {
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    token_type: 'Bearer' as const,
    user: tokens.user,
  };
}

/**
 * Cleanup expired device auth codes (called periodically).
 */
export async function cleanupExpiredDeviceCodes() {
  const result = await prisma.deviceAuthCode.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  if (result.count > 0) {
    log.info(`Cleaned up ${result.count} expired device auth code(s)`);
  }
  return result.count;
}
