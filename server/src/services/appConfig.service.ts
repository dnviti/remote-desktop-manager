import prisma from '../lib/prisma';
import { config } from '../config';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/error.middleware';

const CACHE_TTL_MS = 30_000;
let cache: { selfSignupEnabled: boolean; expiresAt: number } | null = null;

export function isSelfSignupEnvLocked(): boolean {
  return !config.selfSignupEnabled;
}

export async function getSelfSignupEnabled(): Promise<boolean> {
  if (isSelfSignupEnvLocked()) return false;

  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return cache.selfSignupEnabled;
  }

  try {
    const row = await prisma.appConfig.findUnique({
      where: { key: 'selfSignupEnabled' },
    });

    const value = row ? row.value === 'true' : config.selfSignupEnabled;
    cache = { selfSignupEnabled: value, expiresAt: now + CACHE_TTL_MS };
    return value;
  } catch (err) {
    logger.error('Failed to read AppConfig selfSignupEnabled:', err);
    return config.selfSignupEnabled;
  }
}

export async function setSelfSignupEnabled(enabled: boolean): Promise<void> {
  if (isSelfSignupEnvLocked()) {
    throw new AppError(
      'Self-signup is disabled at the environment level and cannot be changed via the admin panel.',
      403,
    );
  }
  await prisma.appConfig.upsert({
    where: { key: 'selfSignupEnabled' },
    update: { value: String(enabled) },
    create: { key: 'selfSignupEnabled', value: String(enabled) },
  });
  cache = { selfSignupEnabled: enabled, expiresAt: Date.now() + CACHE_TTL_MS };
}

export async function getPublicConfig(): Promise<{ selfSignupEnabled: boolean; selfSignupEnvLocked: boolean }> {
  return { selfSignupEnabled: await getSelfSignupEnabled(), selfSignupEnvLocked: isSelfSignupEnvLocked() };
}
