import crypto, { createHmac } from 'crypto';
import argon2 from 'argon2';
import type { EncryptedField, VaultSession } from '../types';
import { config } from '../config';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../utils/logger';
import * as cache from '../utils/cacheClient';

const log = logger.child('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const KEY_LENGTH = 32;
const SALT_LENGTH = 32;

// Extended local vault session with stored TTL for correct sliding window renewal.
// We don't modify the shared VaultSession type — this is local-only.
interface LocalVaultSession extends VaultSession {
  ttlMs: number; // 0 = never expires
}

// In-memory vault store (local fallback): userId -> LocalVaultSession
const vaultStore = new Map<string, LocalVaultSession>();

// In-memory vault recovery store (local fallback): userId -> server-encrypted master key.
// Allows MFA-based re-unlock after vault TTL expiry without the user's password.
// Cleared on logout, password change, or server restart.
const vaultRecoveryStore = new Map<string, { encryptedKey: EncryptedField; expiresAt: number }>();

// In-memory team vault store (local fallback): "${teamId}:${userId}" -> decrypted team master key
const teamVaultStore = new Map<string, { teamKey: Buffer; expiresAt: number; ttlMs: number }>();

// In-memory tenant vault store (local fallback): "${tenantId}:${userId}" -> decrypted tenant master key
const tenantVaultStore = new Map<string, { tenantKey: Buffer; expiresAt: number; ttlMs: number }>();

/**
 * Cache index helpers for team/tenant vault cleanup.
 *
 * These perform non-atomic read-modify-write on JSON arrays. Concurrent
 * writers can lose entries, but the impact is limited: a lost entry means
 * a team/tenant vault session may persist in cache until its TTL expires
 * (typically 30 minutes) rather than being cleaned up immediately on lock.
 * This is an acceptable trade-off given the low frequency of concurrent
 * team vault operations and the TTL safety net.
 */

async function addToIndex(indexKey: string, value: string): Promise<void> {
  const buf = await cache.get(indexKey);
  const arr: string[] = buf ? JSON.parse(buf.toString()) : [];
  if (!arr.includes(value)) arr.push(value);
  await cache.set(indexKey, JSON.stringify(arr));
}

async function removeFromIndex(indexKey: string, value: string): Promise<void> {
  const buf = await cache.get(indexKey);
  if (!buf) return;
  const arr: string[] = JSON.parse(buf.toString()).filter((v: string) => v !== value);
  if (arr.length > 0) await cache.set(indexKey, JSON.stringify(arr));
  else await cache.del(indexKey);
}

// Simplified local-only cleanup every minute.
// Cache TTL handles expiry for cross-instance entries.
setInterval(() => {
  const now = Date.now();
  for (const [userId, session] of vaultStore.entries()) {
    if (session.expiresAt !== Infinity && session.expiresAt < now) {
      session.masterKey.fill(0);
      vaultStore.delete(userId);
    }
  }
  for (const [key, session] of teamVaultStore.entries()) {
    if (session.expiresAt < now) {
      session.teamKey.fill(0);
      teamVaultStore.delete(key);
    }
  }
  for (const [key, session] of tenantVaultStore.entries()) {
    if (session.expiresAt < now) {
      session.tenantKey.fill(0);
      tenantVaultStore.delete(key);
    }
  }
  for (const [userId, entry] of vaultRecoveryStore.entries()) {
    if (entry.expiresAt < now) {
      vaultRecoveryStore.delete(userId);
    }
  }
}, 60_000);

export function generateSalt(): string {
  return crypto.randomBytes(SALT_LENGTH).toString('hex');
}

export function generateMasterKey(): Buffer {
  return crypto.randomBytes(KEY_LENGTH);
}

export async function deriveKeyFromPassword(
  password: string,
  salt: string
): Promise<Buffer> {
  const saltBuffer = Buffer.from(salt, 'hex');
  const hash = await argon2.hash(password, {
    salt: saltBuffer,
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
    hashLength: KEY_LENGTH,
    raw: true,
  });
  return hash;
}

export function encrypt(plaintext: string, key: Buffer): EncryptedField {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  return {
    ciphertext,
    iv: iv.toString('hex'),
    tag,
  };
}

export function decrypt(field: EncryptedField, key: Buffer): string {
  const iv = Buffer.from(field.iv, 'hex');
  const tag = Buffer.from(field.tag, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let plaintext = decipher.update(field.ciphertext, 'hex', 'utf8');
  plaintext += decipher.final('utf8');

  return plaintext;
}

export async function requireMasterKey(
  userId: string,
  message = 'Vault is locked. Please unlock it first.',
  statusCode = 403
): Promise<Buffer> {
  const key = await getMasterKey(userId);
  if (!key) throw new AppError(message, statusCode);
  return key;
}

export function reEncryptField(
  field: EncryptedField,
  sourceKey: Buffer,
  targetKey: Buffer
): EncryptedField {
  const plaintext = decrypt(field, sourceKey);
  return encrypt(plaintext, targetKey);
}

export function encryptMasterKey(
  masterKey: Buffer,
  derivedKey: Buffer
): EncryptedField {
  return encrypt(masterKey.toString('hex'), derivedKey);
}

export function decryptMasterKey(
  encryptedKey: EncryptedField,
  derivedKey: Buffer
): Buffer {
  const hex = decrypt(encryptedKey, derivedKey);
  return Buffer.from(hex, 'hex');
}

// Vault recovery key (for password reset)

export function generateRecoveryKey(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export async function encryptMasterKeyWithRecovery(
  masterKey: Buffer,
  recoveryKey: string
): Promise<{ encrypted: EncryptedField; salt: string }> {
  const salt = generateSalt();
  const derivedKey = await deriveKeyFromPassword(recoveryKey, salt);
  const encrypted = encryptMasterKey(masterKey, derivedKey);
  derivedKey.fill(0);
  return { encrypted, salt };
}

export async function decryptMasterKeyWithRecovery(
  encryptedField: EncryptedField,
  recoveryKey: string,
  salt: string
): Promise<Buffer> {
  const derivedKey = await deriveKeyFromPassword(recoveryKey, salt);
  const masterKey = decryptMasterKey(encryptedField, derivedKey);
  derivedKey.fill(0);
  return masterKey;
}

// External share key derivation

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function deriveKeyFromToken(token: string, shareId: string, salt?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ikm = Buffer.from(token, 'base64url');
    const saltBuf = salt ? Buffer.from(salt, 'base64') : Buffer.alloc(0);
    const info = Buffer.from(shareId, 'utf8');
    crypto.hkdf('sha256', ikm, saltBuf, info, KEY_LENGTH, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(Buffer.from(derivedKey));
    });
  });
}

export async function deriveKeyFromTokenAndPin(
  token: string,
  pin: string,
  salt: string
): Promise<Buffer> {
  return deriveKeyFromPassword(token + pin, salt);
}

// Server-level encryption (for data the server must decrypt autonomously, e.g. SSH key pairs)

export function encryptWithServerKey(plaintext: string): EncryptedField {
  log.debug('Encrypting data with server key');
  return encrypt(plaintext, config.serverEncryptionKey);
}

export function decryptWithServerKey(field: EncryptedField): string {
  log.debug('Decrypting data with server key');
  return decrypt(field, config.serverEncryptionKey);
}

// Vault session management

// ttlMinutes: undefined = server default, 0 = never, >0 = custom
export function storeVaultSession(userId: string, masterKey: Buffer, ttlMinutes?: number): void {
  const effective = ttlMinutes ?? config.vaultTtlMinutes;
  const ttlMs = effective === 0 ? 0 : effective * 60 * 1000;
  const expiresAt = effective === 0 ? Infinity : Date.now() + ttlMs;
  // Local map (sync, immediate)
  vaultStore.set(userId, {
    masterKey: Buffer.from(masterKey), // copy the buffer
    expiresAt,
    ttlMs,
  });
  // Cache (async, fire-and-forget)
  if (config.cacheSidecarEnabled && effective !== 0) {
    const ttlMs = effective * 60 * 1000;
    const encrypted = encrypt(masterKey.toString('hex'), config.serverEncryptionKey);
    cache.set(`vault:user:${userId}`, JSON.stringify(encrypted), { ttl: ttlMs }).catch(() => {});
  }
  log.debug(`Vault session stored for user ${userId} (TTL ${effective === 0 ? 'never' : effective + 'm'})`);
}

export async function getVaultSession(userId: string): Promise<VaultSession | null> {
  // Check local map first (fast path)
  const local = vaultStore.get(userId);
  if (local) {
    if (local.expiresAt !== Infinity && local.expiresAt < Date.now()) {
      local.masterKey.fill(0);
      vaultStore.delete(userId);
      // Fall through to cache check
    } else {
      // Sliding window: reset TTL on every successful access (skip for "never" sessions)
      if (local.expiresAt !== Infinity && local.ttlMs > 0) {
        local.expiresAt = Date.now() + local.ttlMs;
        // Refresh cache TTL (fire-and-forget)
        if (config.cacheSidecarEnabled) {
          const encrypted = encrypt(local.masterKey.toString('hex'), config.serverEncryptionKey);
          cache.set(`vault:user:${userId}`, JSON.stringify(encrypted), { ttl: local.ttlMs }).catch(() => {});
        }
      }
      return local;
    }
  }

  // Cache fallback (cross-instance)
  if (!config.cacheSidecarEnabled) return null;
  const buf = await cache.get(`vault:user:${userId}`);
  if (!buf) return null;
  try {
    const encrypted = JSON.parse(buf.toString()) as EncryptedField;
    const hex = decrypt(encrypted, config.serverEncryptionKey);
    const masterKey = Buffer.from(hex, 'hex');
    // When hydrating from cache, original TTL is unknown; use server default
    const ttlMs = config.vaultTtlMinutes * 60 * 1000;
    const session: LocalVaultSession = { masterKey, expiresAt: Date.now() + ttlMs, ttlMs };
    // Hydrate local map
    vaultStore.set(userId, { masterKey: Buffer.from(masterKey), expiresAt: session.expiresAt, ttlMs });
    // Refresh cache TTL (sliding window)
    cache.set(`vault:user:${userId}`, buf.toString(), { ttl: ttlMs }).catch(() => {});
    return session;
  } catch {
    return null;
  }
}

export async function getMasterKey(userId: string): Promise<Buffer | null> {
  const session = await getVaultSession(userId);
  return session?.masterKey ?? null;
}

// Hard lock: clears vault session, team/tenant vaults, AND recovery entry.
// Used by logout and password change.
export function lockVault(userId: string): void {
  // Sync local operations
  const session = vaultStore.get(userId);
  if (session) {
    session.masterKey.fill(0);
    vaultStore.delete(userId);
    log.debug(`Vault locked for user ${userId}`);
  }
  clearVaultRecovery(userId);
  lockUserTeamVaults(userId);
  lockUserTenantVaults(userId);
  // Async cache cleanup (fire-and-forget)
  if (config.cacheSidecarEnabled) {
    cache.del(`vault:user:${userId}`).catch(() => {});
    cache.del(`vault:recovery:${userId}`).catch(() => {});
    // Publish vault lock event
    cache.publish('vault:status', JSON.stringify({ userId, unlocked: false })).catch(() => {});
  }
}

// Soft lock: clears vault session and team/tenant vaults but keeps
// the recovery entry so MFA can re-unlock without the password.
export function softLockVault(userId: string): void {
  // Sync local operations
  const session = vaultStore.get(userId);
  if (session) {
    session.masterKey.fill(0);
    vaultStore.delete(userId);
    log.debug(`Vault soft-locked for user ${userId} (recovery preserved)`);
  }
  lockUserTeamVaults(userId);
  lockUserTenantVaults(userId);
  // Async cache cleanup (fire-and-forget) — keep recovery entry
  if (config.cacheSidecarEnabled) {
    cache.del(`vault:user:${userId}`).catch(() => {});
    cache.publish('vault:status', JSON.stringify({ userId, unlocked: false })).catch(() => {});
  }
}

export async function isVaultUnlocked(userId: string): Promise<boolean> {
  return (await getVaultSession(userId)) !== null;
}

// Vault recovery management (MFA-based re-unlock)

export function storeVaultRecovery(userId: string, masterKey: Buffer): void {
  const encryptedKey = encrypt(masterKey.toString('hex'), config.serverEncryptionKey);
  // Local map (sync, immediate)
  vaultRecoveryStore.set(userId, {
    encryptedKey,
    expiresAt: Date.now() + config.vaultRecoveryTtlMs,
  });
  // Cache (async, fire-and-forget)
  if (config.cacheSidecarEnabled) {
    cache.set(
      `vault:recovery:${userId}`,
      JSON.stringify(encryptedKey),
      { ttl: config.vaultRecoveryTtlMs },
    ).catch(() => {});
  }
  log.debug(`Vault recovery stored for user ${userId}`);
}

export async function getVaultRecovery(userId: string): Promise<Buffer | null> {
  // Check local map first
  const entry = vaultRecoveryStore.get(userId);
  if (entry) {
    if (entry.expiresAt < Date.now()) {
      vaultRecoveryStore.delete(userId);
      // Fall through to cache check
    } else {
      const hex = decrypt(entry.encryptedKey, config.serverEncryptionKey);
      return Buffer.from(hex, 'hex');
    }
  }
  // Cache fallback (cross-instance)
  if (!config.cacheSidecarEnabled) return null;
  const buf = await cache.get(`vault:recovery:${userId}`);
  if (!buf) return null;
  try {
    const encryptedKey = JSON.parse(buf.toString()) as EncryptedField;
    const hex = decrypt(encryptedKey, config.serverEncryptionKey);
    // Hydrate local map
    vaultRecoveryStore.set(userId, {
      encryptedKey,
      expiresAt: Date.now() + config.vaultRecoveryTtlMs,
    });
    return Buffer.from(hex, 'hex');
  } catch {
    return null;
  }
}

export async function hasVaultRecovery(userId: string): Promise<boolean> {
  // Check local map first
  const entry = vaultRecoveryStore.get(userId);
  if (entry) {
    if (entry.expiresAt < Date.now()) {
      vaultRecoveryStore.delete(userId);
      // Fall through to cache check
    } else {
      return true;
    }
  }
  // Cache fallback
  if (!config.cacheSidecarEnabled) return false;
  const buf = await cache.get(`vault:recovery:${userId}`);
  return buf !== null;
}

export function clearVaultRecovery(userId: string): void {
  vaultRecoveryStore.delete(userId);
  if (config.cacheSidecarEnabled) {
    cache.del(`vault:recovery:${userId}`).catch(() => {});
  }
}

// Team vault session management

export function generateTeamMasterKey(): Buffer {
  return crypto.randomBytes(KEY_LENGTH);
}

export function encryptTeamKey(teamKey: Buffer, userMasterKey: Buffer): EncryptedField {
  return encrypt(teamKey.toString('hex'), userMasterKey);
}

export function decryptTeamKey(encryptedField: EncryptedField, userMasterKey: Buffer): Buffer {
  const hex = decrypt(encryptedField, userMasterKey);
  return Buffer.from(hex, 'hex');
}

export function storeTeamVaultSession(teamId: string, userId: string, teamKey: Buffer): void {
  const ttlMs = config.vaultTtlMinutes * 60 * 1000;
  const mapKey = `${teamId}:${userId}`;
  // Local map (sync, immediate)
  teamVaultStore.set(mapKey, {
    teamKey: Buffer.from(teamKey), // defensive copy
    expiresAt: Date.now() + ttlMs,
    ttlMs,
  });
  // Cache (async, fire-and-forget)
  if (config.cacheSidecarEnabled) {
    const encrypted = encrypt(teamKey.toString('hex'), config.serverEncryptionKey);
    cache.set(`vault:team:${teamId}:${userId}`, JSON.stringify(encrypted), { ttl: ttlMs }).catch(() => {});
    // Update indexes for prefix-based cleanup
    addToIndex(`vault:team-idx:${teamId}`, userId).catch(() => {});
    addToIndex(`vault:user-teams:${userId}`, teamId).catch(() => {});
  }
}

export async function getTeamMasterKey(teamId: string, userId: string): Promise<Buffer | null> {
  const mapKey = `${teamId}:${userId}`;
  // Check local map first (fast path)
  const session = teamVaultStore.get(mapKey);
  if (session) {
    if (session.expiresAt < Date.now()) {
      session.teamKey.fill(0);
      teamVaultStore.delete(mapKey);
      // Fall through to cache check
    } else {
      // Sliding window: use stored ttlMs instead of config default
      session.expiresAt = Date.now() + session.ttlMs;
      if (config.cacheSidecarEnabled) {
        const encrypted = encrypt(session.teamKey.toString('hex'), config.serverEncryptionKey);
        cache.set(`vault:team:${teamId}:${userId}`, JSON.stringify(encrypted), { ttl: session.ttlMs }).catch(() => {});
      }
      return session.teamKey;
    }
  }
  // Cache fallback (cross-instance)
  if (!config.cacheSidecarEnabled) return null;
  const buf = await cache.get(`vault:team:${teamId}:${userId}`);
  if (!buf) return null;
  try {
    const encrypted = JSON.parse(buf.toString()) as EncryptedField;
    const hex = decrypt(encrypted, config.serverEncryptionKey);
    const teamKey = Buffer.from(hex, 'hex');
    const ttlMs = config.vaultTtlMinutes * 60 * 1000;
    // Hydrate local map (use server default TTL since original is unknown)
    teamVaultStore.set(mapKey, { teamKey: Buffer.from(teamKey), expiresAt: Date.now() + ttlMs, ttlMs });
    // Refresh cache TTL (sliding window)
    cache.set(`vault:team:${teamId}:${userId}`, buf.toString(), { ttl: ttlMs }).catch(() => {});
    return teamKey;
  } catch {
    return null;
  }
}

export function lockTeamVault(teamId: string): void {
  // Sync local cleanup
  for (const [key, session] of teamVaultStore.entries()) {
    if (key.startsWith(`${teamId}:`)) {
      session.teamKey.fill(0);
      teamVaultStore.delete(key);
    }
  }
  // Async cache cleanup via index (fire-and-forget)
  if (config.cacheSidecarEnabled) {
    cache.get(`vault:team-idx:${teamId}`).then(async (buf) => {
      if (!buf) return;
      const userIds: string[] = JSON.parse(buf.toString());
      for (const uid of userIds) {
        await cache.del(`vault:team:${teamId}:${uid}`);
        removeFromIndex(`vault:user-teams:${uid}`, teamId).catch(() => {});
      }
      await cache.del(`vault:team-idx:${teamId}`);
    }).catch(() => {});
  }
}

export function lockUserTeamVaults(userId: string): void {
  // Sync local cleanup
  for (const [key, session] of teamVaultStore.entries()) {
    if (key.endsWith(`:${userId}`)) {
      session.teamKey.fill(0);
      teamVaultStore.delete(key);
    }
  }
  // Async cache cleanup via reverse index (fire-and-forget)
  if (config.cacheSidecarEnabled) {
    cache.get(`vault:user-teams:${userId}`).then(async (buf) => {
      if (!buf) return;
      const teamIds: string[] = JSON.parse(buf.toString());
      for (const tid of teamIds) {
        await cache.del(`vault:team:${tid}:${userId}`);
        removeFromIndex(`vault:team-idx:${tid}`, userId).catch(() => {});
      }
      await cache.del(`vault:user-teams:${userId}`);
    }).catch(() => {});
  }
}

// Tenant vault session management

export function generateTenantMasterKey(): Buffer {
  return crypto.randomBytes(KEY_LENGTH);
}

export function encryptTenantKey(tenantKey: Buffer, userMasterKey: Buffer): EncryptedField {
  return encrypt(tenantKey.toString('hex'), userMasterKey);
}

export function decryptTenantKey(encryptedField: EncryptedField, userMasterKey: Buffer): Buffer {
  const hex = decrypt(encryptedField, userMasterKey);
  return Buffer.from(hex, 'hex');
}

export function storeTenantVaultSession(tenantId: string, userId: string, tenantKey: Buffer): void {
  const ttlMs = config.vaultTtlMinutes * 60 * 1000;
  const mapKey = `${tenantId}:${userId}`;
  // Local map (sync, immediate)
  tenantVaultStore.set(mapKey, {
    tenantKey: Buffer.from(tenantKey), // defensive copy
    expiresAt: Date.now() + ttlMs,
    ttlMs,
  });
  // Cache (async, fire-and-forget)
  if (config.cacheSidecarEnabled) {
    const encrypted = encrypt(tenantKey.toString('hex'), config.serverEncryptionKey);
    cache.set(`vault:tenant:${tenantId}:${userId}`, JSON.stringify(encrypted), { ttl: ttlMs }).catch(() => {});
    // Update indexes for prefix-based cleanup
    addToIndex(`vault:tenant-idx:${tenantId}`, userId).catch(() => {});
    addToIndex(`vault:user-tenants:${userId}`, tenantId).catch(() => {});
  }
}

export async function getTenantMasterKey(tenantId: string, userId: string): Promise<Buffer | null> {
  const mapKey = `${tenantId}:${userId}`;
  // Check local map first (fast path)
  const session = tenantVaultStore.get(mapKey);
  if (session) {
    if (session.expiresAt < Date.now()) {
      session.tenantKey.fill(0);
      tenantVaultStore.delete(mapKey);
      // Fall through to cache check
    } else {
      // Sliding window: use stored ttlMs instead of config default
      session.expiresAt = Date.now() + session.ttlMs;
      if (config.cacheSidecarEnabled) {
        const encrypted = encrypt(session.tenantKey.toString('hex'), config.serverEncryptionKey);
        cache.set(`vault:tenant:${tenantId}:${userId}`, JSON.stringify(encrypted), { ttl: session.ttlMs }).catch(() => {});
      }
      return session.tenantKey;
    }
  }
  // Cache fallback (cross-instance)
  if (!config.cacheSidecarEnabled) return null;
  const buf = await cache.get(`vault:tenant:${tenantId}:${userId}`);
  if (!buf) return null;
  try {
    const encrypted = JSON.parse(buf.toString()) as EncryptedField;
    const hex = decrypt(encrypted, config.serverEncryptionKey);
    const tenantKey = Buffer.from(hex, 'hex');
    const ttlMs = config.vaultTtlMinutes * 60 * 1000;
    // Hydrate local map (use server default TTL since original is unknown)
    tenantVaultStore.set(mapKey, { tenantKey: Buffer.from(tenantKey), expiresAt: Date.now() + ttlMs, ttlMs });
    // Refresh cache TTL (sliding window)
    cache.set(`vault:tenant:${tenantId}:${userId}`, buf.toString(), { ttl: ttlMs }).catch(() => {});
    return tenantKey;
  } catch {
    return null;
  }
}

export function lockTenantVault(tenantId: string): void {
  // Sync local cleanup
  for (const [key, session] of tenantVaultStore.entries()) {
    if (key.startsWith(`${tenantId}:`)) {
      session.tenantKey.fill(0);
      tenantVaultStore.delete(key);
    }
  }
  // Async cache cleanup via index (fire-and-forget)
  if (config.cacheSidecarEnabled) {
    cache.get(`vault:tenant-idx:${tenantId}`).then(async (buf) => {
      if (!buf) return;
      const userIds: string[] = JSON.parse(buf.toString());
      for (const uid of userIds) {
        await cache.del(`vault:tenant:${tenantId}:${uid}`);
        removeFromIndex(`vault:user-tenants:${uid}`, tenantId).catch(() => {});
      }
      await cache.del(`vault:tenant-idx:${tenantId}`);
    }).catch(() => {});
  }
}

export function lockUserTenantVaults(userId: string): void {
  // Sync local cleanup
  for (const [key, session] of tenantVaultStore.entries()) {
    if (key.endsWith(`:${userId}`)) {
      session.tenantKey.fill(0);
      tenantVaultStore.delete(key);
    }
  }
  // Async cache cleanup via reverse index (fire-and-forget)
  if (config.cacheSidecarEnabled) {
    cache.get(`vault:user-tenants:${userId}`).then(async (buf) => {
      if (!buf) return;
      const tenantIds: string[] = JSON.parse(buf.toString());
      for (const tid of tenantIds) {
        await cache.del(`vault:tenant:${tid}:${userId}`);
        removeFromIndex(`vault:tenant-idx:${tid}`, userId).catch(() => {});
      }
      await cache.del(`vault:user-tenants:${userId}`);
    }).catch(() => {});
  }
}

// Escrow key derivation for pending vault key distribution

export function deriveEscrowKey(tenantId: string): Buffer {
  return createHmac('sha256', config.serverEncryptionKey)
    .update(tenantId)
    .digest();
}

export function encryptWithEscrow(tenantKey: Buffer, escrowKey: Buffer): EncryptedField {
  return encrypt(tenantKey.toString('hex'), escrowKey);
}

export function decryptWithEscrow(field: EncryptedField, escrowKey: Buffer): Buffer {
  const hex = decrypt(field, escrowKey);
  return Buffer.from(hex, 'hex');
}
