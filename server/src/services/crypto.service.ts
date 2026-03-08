import crypto from 'crypto';
import argon2 from 'argon2';
import { EncryptedField, VaultSession } from '../types';
import { config } from '../config';
import { logger } from '../utils/logger';
import * as auditService from './audit.service';

const log = logger.child('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const KEY_LENGTH = 32;
const SALT_LENGTH = 32;

// In-memory vault store: userId -> VaultSession
const vaultStore = new Map<string, VaultSession>();

// In-memory vault recovery store: userId -> server-encrypted master key.
// Allows MFA-based re-unlock after vault TTL expiry without the user's password.
// Cleared on logout, password change, or server restart.
const vaultRecoveryStore = new Map<string, { encryptedKey: EncryptedField; expiresAt: number }>();

// In-memory team vault store: "${teamId}:${userId}" -> decrypted team master key
const teamVaultStore = new Map<string, { teamKey: Buffer; expiresAt: number }>();

// In-memory tenant vault store: "${tenantId}:${userId}" -> decrypted tenant master key
const tenantVaultStore = new Map<string, { tenantKey: Buffer; expiresAt: number }>();

// Cleanup expired sessions every minute
setInterval(() => {
  const now = Date.now();
  for (const [userId, session] of vaultStore.entries()) {
    if (session.expiresAt < now) {
      session.masterKey.fill(0); // zero out the key
      vaultStore.delete(userId);
      // Soft lock: keep recovery entry so MFA can re-unlock
      lockUserTeamVaults(userId);
      lockUserTenantVaults(userId);
      auditService.log({
        userId,
        action: 'VAULT_AUTO_LOCK',
        targetType: 'User',
        targetId: userId,
        details: { reason: 'ttl_expired' },
      });
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
  const expiresAt = effective === 0 ? Infinity : Date.now() + effective * 60 * 1000;
  vaultStore.set(userId, {
    masterKey: Buffer.from(masterKey), // copy the buffer
    expiresAt,
  });
  log.debug(`Vault session stored for user ${userId} (TTL ${effective === 0 ? 'never' : effective + 'm'})`);
}

export function getVaultSession(userId: string): VaultSession | null {
  const session = vaultStore.get(userId);
  if (!session) return null;

  if (session.expiresAt !== Infinity && session.expiresAt < Date.now()) {
    session.masterKey.fill(0);
    vaultStore.delete(userId);
    return null;
  }

  // Sliding window: reset TTL on every successful access (skip for "never" sessions)
  if (session.expiresAt !== Infinity) {
    const ttlMs = config.vaultTtlMinutes * 60 * 1000;
    session.expiresAt = Date.now() + ttlMs;
  }

  return session;
}

export function getMasterKey(userId: string): Buffer | null {
  const session = getVaultSession(userId);
  return session?.masterKey ?? null;
}

// Hard lock: clears vault session, team/tenant vaults, AND recovery entry.
// Used by logout and password change.
export function lockVault(userId: string): void {
  const session = vaultStore.get(userId);
  if (session) {
    session.masterKey.fill(0);
    vaultStore.delete(userId);
    log.debug(`Vault locked for user ${userId}`);
  }
  clearVaultRecovery(userId);
  lockUserTeamVaults(userId);
  lockUserTenantVaults(userId);
}

// Soft lock: clears vault session and team/tenant vaults but keeps
// the recovery entry so MFA can re-unlock without the password.
export function softLockVault(userId: string): void {
  const session = vaultStore.get(userId);
  if (session) {
    session.masterKey.fill(0);
    vaultStore.delete(userId);
    log.debug(`Vault soft-locked for user ${userId} (recovery preserved)`);
  }
  lockUserTeamVaults(userId);
  lockUserTenantVaults(userId);
}

export function isVaultUnlocked(userId: string): boolean {
  return getVaultSession(userId) !== null;
}

// Vault recovery management (MFA-based re-unlock)

export function storeVaultRecovery(userId: string, masterKey: Buffer): void {
  const encryptedKey = encrypt(masterKey.toString('hex'), config.serverEncryptionKey);
  vaultRecoveryStore.set(userId, {
    encryptedKey,
    expiresAt: Date.now() + config.vaultRecoveryTtlMs,
  });
  log.debug(`Vault recovery stored for user ${userId}`);
}

export function getVaultRecovery(userId: string): Buffer | null {
  const entry = vaultRecoveryStore.get(userId);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    vaultRecoveryStore.delete(userId);
    return null;
  }
  const hex = decrypt(entry.encryptedKey, config.serverEncryptionKey);
  return Buffer.from(hex, 'hex');
}

export function hasVaultRecovery(userId: string): boolean {
  const entry = vaultRecoveryStore.get(userId);
  if (!entry) return false;
  if (entry.expiresAt < Date.now()) {
    vaultRecoveryStore.delete(userId);
    return false;
  }
  return true;
}

export function clearVaultRecovery(userId: string): void {
  vaultRecoveryStore.delete(userId);
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
  const key = `${teamId}:${userId}`;
  teamVaultStore.set(key, {
    teamKey: Buffer.from(teamKey), // defensive copy
    expiresAt: Date.now() + ttlMs,
  });
}

export function getTeamMasterKey(teamId: string, userId: string): Buffer | null {
  const key = `${teamId}:${userId}`;
  const session = teamVaultStore.get(key);
  if (!session) return null;

  if (session.expiresAt < Date.now()) {
    session.teamKey.fill(0);
    teamVaultStore.delete(key);
    return null;
  }

  // Sliding window: reset TTL on every successful access
  const ttlMs = config.vaultTtlMinutes * 60 * 1000;
  session.expiresAt = Date.now() + ttlMs;
  return session.teamKey;
}

export function lockTeamVault(teamId: string): void {
  for (const [key, session] of teamVaultStore.entries()) {
    if (key.startsWith(`${teamId}:`)) {
      session.teamKey.fill(0);
      teamVaultStore.delete(key);
    }
  }
}

export function lockUserTeamVaults(userId: string): void {
  for (const [key, session] of teamVaultStore.entries()) {
    if (key.endsWith(`:${userId}`)) {
      session.teamKey.fill(0);
      teamVaultStore.delete(key);
    }
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
  const key = `${tenantId}:${userId}`;
  tenantVaultStore.set(key, {
    tenantKey: Buffer.from(tenantKey), // defensive copy
    expiresAt: Date.now() + ttlMs,
  });
}

export function getTenantMasterKey(tenantId: string, userId: string): Buffer | null {
  const key = `${tenantId}:${userId}`;
  const session = tenantVaultStore.get(key);
  if (!session) return null;

  if (session.expiresAt < Date.now()) {
    session.tenantKey.fill(0);
    tenantVaultStore.delete(key);
    return null;
  }

  // Sliding window: reset TTL on every successful access
  const ttlMs = config.vaultTtlMinutes * 60 * 1000;
  session.expiresAt = Date.now() + ttlMs;
  return session.tenantKey;
}

export function lockTenantVault(tenantId: string): void {
  for (const [key, session] of tenantVaultStore.entries()) {
    if (key.startsWith(`${tenantId}:`)) {
      session.tenantKey.fill(0);
      tenantVaultStore.delete(key);
    }
  }
}

export function lockUserTenantVaults(userId: string): void {
  for (const [key, session] of tenantVaultStore.entries()) {
    if (key.endsWith(`:${userId}`)) {
      session.tenantKey.fill(0);
      tenantVaultStore.delete(key);
    }
  }
}
