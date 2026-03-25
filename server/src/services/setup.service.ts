import bcrypt from 'bcrypt';
import prisma, { Prisma } from '../lib/prisma';
import * as tenantService from './tenant.service';
import * as authService from './auth.service';
import {
  generateSalt,
  generateMasterKey,
  deriveKeyFromPassword,
  encryptMasterKey,
  generateRecoveryKey,
  encryptMasterKeyWithRecovery,
  storeVaultSession,
  storeVaultRecovery,
} from './crypto.service';
import { logger } from '../utils/logger';
import type { SetupCompleteInput } from '../schemas/setup.schemas';

const BCRYPT_ROUNDS = 12;

let setupCompletedCache: { value: boolean; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

/**
 * Check if initial platform setup is required.
 * Returns true when there are zero users AND setup has not been completed.
 */
export async function isSetupRequired(): Promise<boolean> {
  // Fast path: if setup is already marked completed, skip the user count
  const completed = await isSetupCompleted();
  if (completed) return false;

  const userCount = await prisma.user.count({ take: 1 });
  return userCount === 0;
}

/**
 * Check if setup has been completed (AppConfig flag).
 * Cached for 60 seconds.
 */
export async function isSetupCompleted(): Promise<boolean> {
  const now = Date.now();
  if (setupCompletedCache && setupCompletedCache.expiresAt > now) {
    return setupCompletedCache.value;
  }

  const row = await prisma.appConfig.findUnique({ where: { key: 'setupCompleted' } });
  const value = row?.value === 'true';
  setupCompletedCache = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

/**
 * Complete initial platform setup in a single atomic operation.
 * Creates admin user, tenant, and optionally configures platform settings.
 * Returns credentials for auto-login.
 */
export async function completeSetup(data: SetupCompleteInput) {
  // Guard: reject if setup already completed
  const required = await isSetupRequired();
  if (!required) {
    throw new Error('Setup has already been completed');
  }

  const { admin, tenant, settings } = data;

  // 1. Hash admin password
  const passwordHash = await bcrypt.hash(admin.password, BCRYPT_ROUNDS);

  // 2. Generate vault encryption keys (same as demo.commands.ts / auth.service.register)
  const vaultSalt = generateSalt();
  const masterKey = generateMasterKey();
  const derivedKey = await deriveKeyFromPassword(admin.password, vaultSalt);
  const encryptedVault = encryptMasterKey(masterKey, derivedKey);

  const recoveryKey = generateRecoveryKey();
  const recoveryResult = await encryptMasterKeyWithRecovery(masterKey, recoveryKey);

  // Zero sensitive buffers
  derivedKey.fill(0);

  // 3. Atomic transaction: create user + tenant + settings
  const user = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Create admin user
    const newUser = await tx.user.create({
      data: {
        email: admin.email,
        username: admin.username || null,
        passwordHash,
        vaultSalt,
        encryptedVaultKey: encryptedVault.ciphertext,
        vaultKeyIV: encryptedVault.iv,
        vaultKeyTag: encryptedVault.tag,
        encryptedVaultRecoveryKey: recoveryResult.encrypted.ciphertext,
        vaultRecoveryKeyIV: recoveryResult.encrypted.iv,
        vaultRecoveryKeyTag: recoveryResult.encrypted.tag,
        vaultRecoveryKeySalt: recoveryResult.salt,
        emailVerified: true,
        vaultSetupComplete: true,
      },
    });

    // Store self-signup preference
    if (settings?.selfSignupEnabled !== undefined) {
      await tx.appConfig.upsert({
        where: { key: 'selfSignupEnabled' },
        update: { value: String(settings.selfSignupEnabled) },
        create: { key: 'selfSignupEnabled', value: String(settings.selfSignupEnabled) },
      });
    }

    // Store SMTP settings if provided
    if (settings?.smtp) {
      const smtpEntries = [
        { key: 'smtpHost', value: settings.smtp.host },
        { key: 'smtpPort', value: String(settings.smtp.port) },
        ...(settings.smtp.user ? [{ key: 'smtpUser', value: settings.smtp.user }] : []),
        ...(settings.smtp.pass ? [{ key: 'smtpPass', value: settings.smtp.pass }] : []),
        ...(settings.smtp.from ? [{ key: 'smtpFrom', value: settings.smtp.from }] : []),
        ...(settings.smtp.secure !== undefined ? [{ key: 'smtpSecure', value: String(settings.smtp.secure) }] : []),
      ];

      for (const entry of smtpEntries) {
        await tx.appConfig.upsert({
          where: { key: entry.key },
          update: { value: entry.value },
          create: { key: entry.key, value: entry.value },
        });
      }
    }

    // Mark setup as completed
    await tx.appConfig.upsert({
      where: { key: 'setupCompleted' },
      update: { value: 'true' },
      create: { key: 'setupCompleted', value: 'true' },
    });

    return newUser;
  });

  // Auto-unlock vault: store the master key in the in-memory vault session
  // (must happen before we zero the buffer)
  storeVaultSession(user.id, masterKey);
  storeVaultRecovery(user.id, masterKey);

  // Zero master key after storing in vault session
  masterKey.fill(0);

  // Invalidate cache
  setupCompletedCache = { value: true, expiresAt: Date.now() + CACHE_TTL_MS };

  // 4. Create tenant (outside transaction — it has its own transaction + SSH key gen)
  let tenantInfo;
  try {
    tenantInfo = await tenantService.createTenant(user.id, tenant.name);
    logger.info(`Setup wizard: created tenant "${tenant.name}" for admin ${admin.email}`);
  } catch (err) {
    logger.error('Setup wizard: tenant creation failed:', err instanceof Error ? err.message : 'Unknown error');
    throw new Error('Admin user created but tenant creation failed. Please log in and create an organization manually.');
  }

  // 5. Issue tokens for auto-login
  const tokens = await authService.issueTokens({
    id: user.id,
    email: user.email,
    username: user.username,
    avatarData: user.avatarData,
  });

  logger.info(`Setup wizard completed: admin=${admin.email}, tenant=${tenant.name}`);

  return {
    recoveryKey,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
    },
    tenant: tenantInfo,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tenantMemberships: tokens.tenantMemberships,
  };
}

/**
 * Get database connection status by parsing DATABASE_URL and testing connectivity.
 */
export async function getDbStatus(): Promise<{
  host: string;
  port: number;
  database: string;
  connected: boolean;
  version: string | null;
}> {
  const dbUrl = process.env.DATABASE_URL || '';
  let host = '', port = 5432, database = '';
  try {
    const url = new URL(dbUrl);
    host = url.hostname;
    port = parseInt(url.port || '5432', 10);
    database = url.pathname.replace(/^\//, '');
  } catch { /* invalid URL */ }

  let connected = false;
  let version: string | null = null;
  try {
    const result = await prisma.$queryRawUnsafe<[{ version: string }]>('SELECT version()');
    connected = true;
    // Only expose the engine name and major version (e.g. "PostgreSQL 16.x"),
    // not the full build string which leaks OS/compiler/architecture details.
    const raw = result[0]?.version || '';
    const match = raw.match(/^(\w+)\s+([\d]+(?:\.[\d]+)?)/);
    version = match ? `${match[1]} ${match[2]}` : (raw ? 'connected' : null);
  } catch { /* connection failed */ }

  return { host, port, database, connected, version };
}
