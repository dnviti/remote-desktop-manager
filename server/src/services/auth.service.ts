import crypto from 'crypto';
import prisma from '../lib/prisma';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { AuthPayload } from '../types';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../utils/logger';
import {
  generateSalt,
  generateMasterKey,
  deriveKeyFromPassword,
  encryptMasterKey,
  decryptMasterKey,
  storeVaultSession,
} from './crypto.service';
import { verifyCode as verifyTotpCode } from './totp.service';
import { sendVerificationEmail } from './email.service';

const BCRYPT_ROUNDS = 12;
const RESEND_COOLDOWN_MS = 60 * 1000;
const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

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

  const emailVerifyToken = crypto.randomBytes(32).toString('hex');
  const emailVerifyExpiry = new Date(Date.now() + EMAIL_VERIFY_TTL_MS);

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      vaultSalt,
      encryptedVaultKey: encryptedVault.ciphertext,
      vaultKeyIV: encryptedVault.iv,
      vaultKeyTag: encryptedVault.tag,
      emailVerified: false,
      emailVerifyToken,
      emailVerifyExpiry,
    },
    select: { id: true, email: true, createdAt: true },
  });

  // Zero out sensitive data
  masterKey.fill(0);
  derivedKey.fill(0);

  sendVerificationEmail(email, emailVerifyToken).catch((err) => {
    logger.error('Failed to send verification email:', err);
  });

  return { message: 'Registration successful. Please check your email to verify your account.', userId: user.id };
}

export async function issueTokens(user: {
  id: string;
  email: string;
  username: string | null;
  avatarData: string | null;
  tenantId?: string | null;
  tenantRole?: string | null;
}) {
  const payload: AuthPayload = {
    userId: user.id,
    email: user.email,
    ...(user.tenantId && { tenantId: user.tenantId }),
    ...(user.tenantRole && { tenantRole: user.tenantRole as AuthPayload['tenantRole'] }),
  };
  const accessToken = jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as string,
  } as jwt.SignOptions);

  const refreshTokenValue = uuidv4();
  const refreshExpiresMs = parseExpiry(config.jwtRefreshExpiresIn);
  await prisma.refreshToken.create({
    data: {
      token: refreshTokenValue,
      userId: user.id,
      expiresAt: new Date(Date.now() + refreshExpiresMs),
    },
  });

  return {
    accessToken,
    refreshToken: refreshTokenValue,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      avatarData: user.avatarData,
      tenantId: user.tenantId ?? undefined,
      tenantRole: user.tenantRole ?? undefined,
    },
  };
}

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new Error('Invalid email or password');
  }

  // OAuth-only users cannot use password login
  if (!user.passwordHash) {
    throw new AppError('This account uses social login. Please sign in with your OAuth provider.', 400);
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new Error('Invalid email or password');
  }

  if (!user.emailVerified) {
    throw new AppError('Email not verified. Please check your inbox or resend the verification email.', 403);
  }

  // Auto-unlock vault early (before TOTP check) so it's ready
  // when the user completes the second step. If TOTP is abandoned,
  // the vault session simply expires via its TTL.
  if (user.vaultSalt && user.encryptedVaultKey && user.vaultKeyIV && user.vaultKeyTag) {
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
  }

  // If TOTP is enabled, return a temp token instead of real tokens
  if (user.totpEnabled) {
    const tempToken = jwt.sign(
      { userId: user.id, purpose: 'totp-verify' },
      config.jwtSecret,
      { expiresIn: '5m' } as jwt.SignOptions
    );
    return { requiresTOTP: true as const, tempToken };
  }

  // Normal flow: issue real tokens
  const tokens = await issueTokens(user);
  return { requiresTOTP: false as const, ...tokens };
}

export async function verifyTotp(tempToken: string, code: string) {
  let decoded: { userId: string; purpose: string };
  try {
    decoded = jwt.verify(tempToken, config.jwtSecret) as { userId: string; purpose: string };
  } catch {
    throw new Error('Invalid or expired temporary token');
  }

  if (decoded.purpose !== 'totp-verify') {
    throw new Error('Invalid token purpose');
  }

  const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
  if (!user || !user.totpEnabled || !user.totpSecret) {
    throw new Error('2FA verification failed');
  }

  if (!verifyTotpCode(user.totpSecret, code)) {
    throw new Error('Invalid TOTP code');
  }

  // Issue real tokens (vault was already unlocked during password step)
  return issueTokens(user);
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
    ...(stored.user.tenantId && { tenantId: stored.user.tenantId }),
    ...(stored.user.tenantRole && { tenantRole: stored.user.tenantRole as AuthPayload['tenantRole'] }),
  };
  const accessToken = jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as string,
  } as jwt.SignOptions);

  return {
    accessToken,
    user: {
      id: stored.user.id,
      email: stored.user.email,
      username: stored.user.username,
      avatarData: stored.user.avatarData,
      tenantId: stored.user.tenantId ?? undefined,
      tenantRole: stored.user.tenantRole ?? undefined,
    },
  };
}

export async function logout(refreshToken: string): Promise<string | null> {
  const stored = await prisma.refreshToken.findFirst({
    where: { token: refreshToken },
    select: { userId: true },
  });
  await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
  return stored?.userId ?? null;
}

export async function verifyEmail(token: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { emailVerifyToken: token },
  });

  if (!user) {
    throw new AppError('Invalid or expired verification link.', 400);
  }

  if (user.emailVerified) {
    return; // Already verified
  }

  if (!user.emailVerifyExpiry || user.emailVerifyExpiry < new Date()) {
    throw new AppError('Verification link has expired. Please request a new one.', 400);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: true,
      emailVerifyToken: null,
      emailVerifyExpiry: null,
    },
  });
}

export async function resendVerification(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || user.emailVerified) {
    return; // Silently succeed to prevent user enumeration
  }

  // Rate limit: check if last token was generated less than 60s ago
  if (user.emailVerifyExpiry) {
    const tokenCreatedAt = new Date(user.emailVerifyExpiry.getTime() - EMAIL_VERIFY_TTL_MS);
    const elapsed = Date.now() - tokenCreatedAt.getTime();
    if (elapsed < RESEND_COOLDOWN_MS) {
      return; // Silently ignore rapid requests
    }
  }

  const emailVerifyToken = crypto.randomBytes(32).toString('hex');
  const emailVerifyExpiry = new Date(Date.now() + EMAIL_VERIFY_TTL_MS);

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerifyToken, emailVerifyExpiry },
  });

  sendVerificationEmail(email, emailVerifyToken).catch((err) => {
    logger.error('Failed to send verification email:', err);
  });
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
