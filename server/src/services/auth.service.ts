import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { AuthPayload } from '../types';
import {
  generateSalt,
  generateMasterKey,
  deriveKeyFromPassword,
  encryptMasterKey,
  decryptMasterKey,
  storeVaultSession,
} from './crypto.service';

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = 12;

export async function register(email: string, password: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new Error('Email already registered');
  }

  // Hash password for login
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // Generate vault encryption
  const vaultSalt = generateSalt();
  const masterKey = generateMasterKey();
  const derivedKey = await deriveKeyFromPassword(password, vaultSalt);
  const encryptedVault = encryptMasterKey(masterKey, derivedKey);

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      vaultSalt,
      encryptedVaultKey: encryptedVault.ciphertext,
      vaultKeyIV: encryptedVault.iv,
      vaultKeyTag: encryptedVault.tag,
    },
    select: { id: true, email: true, createdAt: true },
  });

  // Zero out sensitive data
  masterKey.fill(0);
  derivedKey.fill(0);

  return user;
}

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new Error('Invalid email or password');
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new Error('Invalid email or password');
  }

  // Generate JWT
  const payload: AuthPayload = { userId: user.id, email: user.email };
  const accessToken = jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as string,
  } as jwt.SignOptions);

  // Generate refresh token
  const refreshTokenValue = uuidv4();
  const refreshExpiresMs = parseExpiry(config.jwtRefreshExpiresIn);
  await prisma.refreshToken.create({
    data: {
      token: refreshTokenValue,
      userId: user.id,
      expiresAt: new Date(Date.now() + refreshExpiresMs),
    },
  });

  // Auto-unlock vault
  const derivedKey = await deriveKeyFromPassword(password, user.vaultSalt);
  const masterKey = decryptMasterKey(
    {
      ciphertext: user.encryptedVaultKey,
      iv: user.vaultKeyIV,
      tag: user.vaultKeyTag,
    },
    derivedKey
  );
  storeVaultSession(user.id, masterKey);
  masterKey.fill(0);
  derivedKey.fill(0);

  return {
    accessToken,
    refreshToken: refreshTokenValue,
    user: { id: user.id, email: user.email },
  };
}

export async function refreshAccessToken(refreshToken: string) {
  const stored = await prisma.refreshToken.findUnique({
    where: { token: refreshToken },
    include: { user: true },
  });

  if (!stored || stored.expiresAt < new Date()) {
    if (stored) {
      await prisma.refreshToken.delete({ where: { id: stored.id } });
    }
    throw new Error('Invalid or expired refresh token');
  }

  const payload: AuthPayload = {
    userId: stored.user.id,
    email: stored.user.email,
  };
  const accessToken = jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as string,
  } as jwt.SignOptions);

  return { accessToken };
}

export async function logout(refreshToken: string) {
  await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
}

function parseExpiry(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000; // default 7d

  const value = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return 7 * 24 * 60 * 60 * 1000;
  }
}
