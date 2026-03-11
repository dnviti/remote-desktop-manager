import { generateSecret, generateURI, verifySync } from 'otplib';
import prisma from '../lib/prisma';
import { AppError } from '../middleware/error.middleware';
import { encrypt, decrypt, getMasterKey, requireMasterKey } from './crypto.service';
import type { EncryptedField } from '../types';

const APP_NAME = 'Arsenale';

/**
 * Resolve the plaintext TOTP secret from either encrypted or legacy plaintext fields.
 * Returns null if no secret is stored.
 */
function resolveSecret(
  user: {
    encryptedTotpSecret: string | null;
    totpSecretIV: string | null;
    totpSecretTag: string | null;
    totpSecret: string | null;
  },
  masterKey: Buffer,
): string | null {
  if (user.encryptedTotpSecret && user.totpSecretIV && user.totpSecretTag) {
    const field: EncryptedField = {
      ciphertext: user.encryptedTotpSecret,
      iv: user.totpSecretIV,
      tag: user.totpSecretTag,
    };
    return decrypt(field, masterKey);
  }
  // Legacy plaintext fallback (lazy migration)
  return user.totpSecret;
}

export function generateSetup(email: string): { secret: string; otpauthUri: string } {
  const secret = generateSecret();
  const otpauthUri = generateURI({
    issuer: APP_NAME,
    label: email,
    secret,
    algorithm: 'sha1',
    digits: 6,
    period: 30,
  });
  return { secret, otpauthUri };
}

export async function storeSetupSecret(userId: string, secret: string): Promise<void> {
  const masterKey = requireMasterKey(userId);
  const enc = encrypt(secret, masterKey);
  await prisma.user.update({
    where: { id: userId },
    data: {
      encryptedTotpSecret: enc.ciphertext,
      totpSecretIV: enc.iv,
      totpSecretTag: enc.tag,
      totpSecret: null,
    },
  });
}

export async function verifyAndEnable(userId: string, code: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      totpSecret: true,
      encryptedTotpSecret: true,
      totpSecretIV: true,
      totpSecretTag: true,
      totpEnabled: true,
    },
  });
  if (!user) throw new AppError('User not found', 404);
  if (user.totpEnabled) throw new AppError('2FA is already enabled', 400);

  const masterKey = requireMasterKey(userId);
  const secret = resolveSecret(user, masterKey);
  if (!secret) throw new AppError('2FA setup not initiated', 400);

  if (!checkCode(secret, code)) {
    throw new AppError('Invalid TOTP code', 400);
  }

  // If we read from legacy plaintext, encrypt it now (lazy migration)
  const data: Record<string, unknown> = { totpEnabled: true };
  if (!user.encryptedTotpSecret && user.totpSecret) {
    const enc = encrypt(secret, masterKey);
    data.encryptedTotpSecret = enc.ciphertext;
    data.totpSecretIV = enc.iv;
    data.totpSecretTag = enc.tag;
    data.totpSecret = null;
  }

  await prisma.user.update({ where: { id: userId }, data });
}

export async function disable(userId: string, code: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      totpSecret: true,
      encryptedTotpSecret: true,
      totpSecretIV: true,
      totpSecretTag: true,
      totpEnabled: true,
    },
  });
  if (!user) throw new AppError('User not found', 404);
  if (!user.totpEnabled) throw new AppError('2FA is not enabled', 400);

  const masterKey = requireMasterKey(userId);
  const secret = resolveSecret(user, masterKey);
  if (!secret) throw new AppError('2FA is not enabled', 400);

  if (!checkCode(secret, code)) {
    throw new AppError('Invalid TOTP code', 400);
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      totpEnabled: false,
      totpSecret: null,
      encryptedTotpSecret: null,
      totpSecretIV: null,
      totpSecretTag: null,
    },
  });
}

/**
 * Decrypt and return the TOTP secret for a given user.
 * Used by auth.service for login-time TOTP verification.
 */
export function getDecryptedSecret(
  user: {
    encryptedTotpSecret: string | null;
    totpSecretIV: string | null;
    totpSecretTag: string | null;
    totpSecret: string | null;
  },
  userId: string,
): string | null {
  const masterKey = getMasterKey(userId);
  if (!masterKey) {
    // Vault not unlocked — fall back to legacy plaintext if available
    return user.totpSecret;
  }
  return resolveSecret(user, masterKey);
}

function checkCode(secret: string, code: string): boolean {
  const result = verifySync({ secret, token: code });
  return result.valid;
}

export function verifyCode(secret: string, code: string): boolean {
  return checkCode(secret, code);
}
