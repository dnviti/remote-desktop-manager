import crypto from 'crypto';
import prisma from '../lib/prisma';
import { encryptWithServerKey, decryptWithServerKey } from './crypto.service';
import { setSystemSecret } from '../config';
import { readSecret } from '../utils/secrets';
import { publish } from '../utils/cacheClient';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Secret definitions — each entry defines a system secret that is automatically
// generated, stored encrypted in the DB, and kept in memory at runtime.
// ---------------------------------------------------------------------------

const SYSTEM_SECRET_DEFS = [
  {
    name: 'jwt_secret',
    bytes: 64,
    envFallback: 'JWT_SECRET',
    configKey: 'jwtSecret' as const,
    distribute: false,
    target: null as string | null,
    rotationDays: 90,
    description: 'JWT signing secret for authentication tokens',
  },
  {
    name: 'guacamole_secret',
    bytes: 32,
    envFallback: 'GUACAMOLE_SECRET',
    configKey: 'guacamoleSecret' as const,
    distribute: false,
    target: null as string | null,
    rotationDays: 90,
    description: 'Encryption key for RDP/VNC session tokens',
  },
  {
    name: 'guacenc_auth_token',
    bytes: 32,
    envFallback: 'GUACENC_AUTH_TOKEN',
    configKey: 'guacencAuthToken' as const,
    distribute: true,
    target: 'guacenc',
    rotationDays: 90,
    description: 'Bearer auth token for the video conversion service',
  },
] as const;

// In-memory cache: name -> { current plaintext, previous plaintext | null }
const secretCache = new Map<string, { current: string; previous: string | null }>();

// ---------------------------------------------------------------------------
// ensureSystemSecrets — called once on startup
// ---------------------------------------------------------------------------

export async function ensureSystemSecrets(): Promise<void> {
  logger.info('[system-secrets] Initializing auto-managed secrets...');

  for (const def of SYSTEM_SECRET_DEFS) {
    const externalValue = readSecret(def.name, def.envFallback);
    const dbRow = await prisma.systemSecret.findUnique({ where: { name: def.name } });

    let currentValue: string;
    let previousValue: string | null = null;

    if (externalValue && !dbRow) {
      // External value provided, no DB row yet — store encrypted in DB
      const encrypted = encryptWithServerKey(externalValue);
      await prisma.systemSecret.create({
        data: {
          name: def.name,
          encryptedValue: encrypted.ciphertext,
          valueIV: encrypted.iv,
          valueTag: encrypted.tag,
          autoRotate: true,
          rotationIntervalDays: def.rotationDays,
          distributed: def.distribute,
          targetService: def.target,
        },
      });
      currentValue = externalValue;
      logger.info(`[system-secrets] Stored external secret "${def.name}" in DB`);
    } else if (externalValue && dbRow) {
      // External value takes precedence — update DB if different
      const dbValue = decryptWithServerKey({
        ciphertext: dbRow.encryptedValue,
        iv: dbRow.valueIV,
        tag: dbRow.valueTag,
      });
      if (dbValue !== externalValue) {
        const encrypted = encryptWithServerKey(externalValue);
        const rotatedAt = new Date();
        await prisma.systemSecret.update({
          where: { name: def.name },
          data: {
            encryptedValue: encrypted.ciphertext,
            valueIV: encrypted.iv,
            valueTag: encrypted.tag,
            previousEncryptedValue: dbRow.encryptedValue,
            previousValueIV: dbRow.valueIV,
            previousValueTag: dbRow.valueTag,
            currentVersion: dbRow.currentVersion + 1,
            rotatedAt,
          },
        });
        previousValue = dbValue;
        logger.info(`[system-secrets] Updated "${def.name}" from external source`);
      } else if (dbRow.previousEncryptedValue && dbRow.previousValueIV && dbRow.previousValueTag) {
        // Preserve previous version if the external value matches current state.
        previousValue = decryptWithServerKey({
          ciphertext: dbRow.previousEncryptedValue,
          iv: dbRow.previousValueIV,
          tag: dbRow.previousValueTag,
        });
      }
      currentValue = externalValue;
    } else if (!externalValue && !dbRow) {
      // No external, no DB — auto-generate
      currentValue = crypto.randomBytes(def.bytes).toString('hex');
      const encrypted = encryptWithServerKey(currentValue);
      await prisma.systemSecret.create({
        data: {
          name: def.name,
          encryptedValue: encrypted.ciphertext,
          valueIV: encrypted.iv,
          valueTag: encrypted.tag,
          autoRotate: true,
          rotationIntervalDays: def.rotationDays,
          distributed: def.distribute,
          targetService: def.target,
        },
      });
      logger.info(`[system-secrets] Auto-generated secret "${def.name}"`);
    } else {
      // No external, DB row exists — decrypt from DB
      currentValue = decryptWithServerKey({
        ciphertext: dbRow!.encryptedValue,
        iv: dbRow!.valueIV,
        tag: dbRow!.valueTag,
      });
      if (dbRow!.previousEncryptedValue && dbRow!.previousValueIV && dbRow!.previousValueTag) {
        previousValue = decryptWithServerKey({
          ciphertext: dbRow!.previousEncryptedValue,
          iv: dbRow!.previousValueIV,
          tag: dbRow!.previousValueTag,
        });
      }
      logger.info(`[system-secrets] Loaded secret "${def.name}" from DB (v${dbRow!.currentVersion})`);
    }

    // Populate in-memory cache
    secretCache.set(def.name, { current: currentValue, previous: previousValue });

    // Push to runtime config
    setSystemSecret(def.configKey, currentValue);
  }

  // Publish distributed secrets to sidecar services
  await publishDistributedSecrets();

  logger.info(`[system-secrets] ${SYSTEM_SECRET_DEFS.length} secret(s) initialized`);
}

// ---------------------------------------------------------------------------
// Getters
// ---------------------------------------------------------------------------

export function getSecretValue(name: string): string {
  const entry = secretCache.get(name);
  if (!entry) {
    throw new Error(`System secret "${name}" not found in cache — was ensureSystemSecrets() called?`);
  }
  return entry.current;
}

export function getSecretValueSync(name: string): { current: string; previous: string | null } {
  const entry = secretCache.get(name);
  if (!entry) {
    throw new Error(`System secret "${name}" not found in cache — was ensureSystemSecrets() called?`);
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------

export async function rotateSecret(name: string): Promise<void> {
  const def = SYSTEM_SECRET_DEFS.find((d) => d.name === name);
  if (!def) throw new Error(`Unknown system secret: "${name}"`);

  const dbRow = await prisma.systemSecret.findUnique({ where: { name } });
  if (!dbRow) throw new Error(`System secret "${name}" not found in DB`);

  // Generate new value
  const newValue = crypto.randomBytes(def.bytes).toString('hex');

  // Read current value (becomes "previous")
  const oldValue = decryptWithServerKey({
    ciphertext: dbRow.encryptedValue,
    iv: dbRow.valueIV,
    tag: dbRow.valueTag,
  });

  // Encrypt new value; copy current ciphertext directly to previous (avoid re-encryption)
  const encryptedNew = encryptWithServerKey(newValue);
  const newVersion = dbRow.currentVersion + 1;

  // Update DB: new → current, old current ciphertext → previous (no re-encryption)
  await prisma.systemSecret.update({
    where: { name },
    data: {
      encryptedValue: encryptedNew.ciphertext,
      valueIV: encryptedNew.iv,
      valueTag: encryptedNew.tag,
      previousEncryptedValue: dbRow.encryptedValue,
      previousValueIV: dbRow.valueIV,
      previousValueTag: dbRow.valueTag,
      currentVersion: newVersion,
      rotatedAt: new Date(),
    },
  });

  // Publish to distributed services BEFORE updating local state
  // (ensures remote services get the update even if local cache update fails)
  if (def.distribute && def.target) {
    const payload = JSON.stringify({
      name: def.name,
      value: newValue,
      version: newVersion,
      rotatedAt: new Date().toISOString(),
    });
    await publish(`system:secret:${def.target}`, payload);
    logger.info(`[system-secrets] Published rotated secret "${name}" to distributed channel`);
  }

  // Update in-memory cache and runtime config
  secretCache.set(name, { current: newValue, previous: oldValue });
  setSystemSecret(def.configKey, newValue);

  logger.info(`[system-secrets] Rotated secret "${name}" to v${newVersion}`);
}

export async function processSecretRotations(): Promise<void> {
  const secrets = await prisma.systemSecret.findMany({
    where: { autoRotate: true },
  });

  for (const secret of secrets) {
    const daysSinceRotation = secret.rotatedAt
      ? (Date.now() - secret.rotatedAt.getTime()) / (1000 * 60 * 60 * 24)
      : (Date.now() - secret.createdAt.getTime()) / (1000 * 60 * 60 * 24);

    if (daysSinceRotation >= secret.rotationIntervalDays) {
      try {
        await rotateSecret(secret.name);
        logger.info(`[system-secrets] Auto-rotated secret "${secret.name}" (${Math.floor(daysSinceRotation)}d since last rotation)`);
      } catch (err) {
        logger.error(
          `[system-secrets] Failed to auto-rotate secret "${secret.name}":`,
          err instanceof Error ? err.message : 'Unknown error',
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Distribution (publish secrets to sidecar services via gocache)
// ---------------------------------------------------------------------------

export async function publishDistributedSecrets(): Promise<void> {
  const distributedDefs = SYSTEM_SECRET_DEFS.filter((d) => d.distribute && d.target);
  if (distributedDefs.length === 0) return;

  // Single query for all distributed secrets (avoids N+1)
  const dbRows = await prisma.systemSecret.findMany({
    where: { name: { in: distributedDefs.map((d) => d.name) } },
  });
  const dbMap = new Map(dbRows.map((r) => [r.name, r]));

  for (const def of distributedDefs) {
    const entry = secretCache.get(def.name);
    const dbRow = dbMap.get(def.name);
    if (!entry || !dbRow) continue;

    const payload = JSON.stringify({
      name: def.name,
      value: entry.current,
      version: dbRow.currentVersion,
      rotatedAt: dbRow.rotatedAt?.toISOString() ?? null,
    });

    await publish(`system:secret:${def.target!}`, payload);
    logger.info(`[system-secrets] Published secret "${def.name}" to distributed channel`);
  }
}

// ---------------------------------------------------------------------------
// Display (for initial setup wizard only)
// ---------------------------------------------------------------------------

export async function getAllSecretsForDisplay(): Promise<Array<{ name: string; value: string; description: string }>> {
  const results: Array<{ name: string; value: string; description: string }> = [];

  for (const def of SYSTEM_SECRET_DEFS) {
    const entry = secretCache.get(def.name);
    if (!entry) continue;

    results.push({
      name: def.envFallback,
      value: entry.current,
      description: def.description,
    });
  }

  return results;
}
