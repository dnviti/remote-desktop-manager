import crypto from 'crypto';
import argon2 from 'argon2';
import { EncryptedField, VaultSession } from '../types';
import { config } from '../config';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const KEY_LENGTH = 32;
const SALT_LENGTH = 32;

// In-memory vault store: userId -> VaultSession
const vaultStore = new Map<string, VaultSession>();

// Cleanup expired sessions every minute
setInterval(() => {
  const now = Date.now();
  for (const [userId, session] of vaultStore.entries()) {
    if (session.expiresAt < now) {
      session.masterKey.fill(0); // zero out the key
      vaultStore.delete(userId);
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

// Vault session management

export function storeVaultSession(userId: string, masterKey: Buffer): void {
  const ttlMs = config.vaultTtlMinutes * 60 * 1000;
  vaultStore.set(userId, {
    masterKey: Buffer.from(masterKey), // copy the buffer
    expiresAt: Date.now() + ttlMs,
  });
}

export function getVaultSession(userId: string): VaultSession | null {
  const session = vaultStore.get(userId);
  if (!session) return null;

  if (session.expiresAt < Date.now()) {
    session.masterKey.fill(0);
    vaultStore.delete(userId);
    return null;
  }

  return session;
}

export function getMasterKey(userId: string): Buffer | null {
  const session = getVaultSession(userId);
  return session?.masterKey ?? null;
}

export function lockVault(userId: string): void {
  const session = vaultStore.get(userId);
  if (session) {
    session.masterKey.fill(0);
    vaultStore.delete(userId);
  }
}

export function isVaultUnlocked(userId: string): boolean {
  return getVaultSession(userId) !== null;
}
