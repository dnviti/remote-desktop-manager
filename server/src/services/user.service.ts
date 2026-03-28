import crypto from 'crypto';
import prisma, { Prisma } from '../lib/prisma';
import bcrypt from 'bcrypt';
import {
  generateSalt,
  deriveKeyFromPassword,
  encryptMasterKey,
  decryptMasterKey,
  getMasterKey,
  lockVault,
  generateRecoveryKey,
  encryptMasterKeyWithRecovery,
} from './crypto.service';
import { AppError } from '../middleware/error.middleware';
import { getEmailStatus, sendEmailChangeCode } from './email';
import * as identityVerification from './identityVerification.service';
import { assertPasswordNotBreached } from './password.service';

const BCRYPT_ROUNDS = 12;
const EMAIL_CHANGE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_AVATAR_SIZE = 200 * 1024; // ~200KB base64

export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, username: true, avatarData: true,
      sshDefaults: true, rdpDefaults: true, createdAt: true,
      vaultSetupComplete: true, passwordHash: true,
      oauthAccounts: {
        select: { provider: true, providerEmail: true, createdAt: true },
      },
    },
  });
  if (!user) throw new AppError('User not found', 404);
  const { passwordHash, ...rest } = user;
  return { ...rest, hasPassword: !!passwordHash };
}

export async function updateProfile(
  userId: string,
  data: { username?: string }
) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(data.username !== undefined && { username: data.username || null }),
    },
    select: { id: true, email: true, username: true, avatarData: true },
  });

  return user;
}

// ---------------------------------------------------------------------------
// Email Change
// ---------------------------------------------------------------------------

function generateOtp(): string {
  const num = crypto.randomInt(0, 1_000_000);
  return num.toString().padStart(6, '0');
}

function hashOtp(otp: string): string {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export async function initiateEmailChange(
  userId: string,
  newEmail: string,
): Promise<{
  flow: 'dual-otp' | 'identity-verification';
  verificationId?: string;
  method?: string;
  metadata?: Record<string, unknown>;
}> {
  const existing = await prisma.user.findUnique({ where: { email: newEmail } });
  if (existing && existing.id !== userId) {
    throw new AppError('Email already in use', 409);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerified: true },
  });
  if (!user) throw new AppError('User not found', 404);

  const emailStatus = getEmailStatus();
  const hasEmail = emailStatus.configured && user.emailVerified;

  if (hasEmail) {
    const otpOld = generateOtp();
    const otpNew = generateOtp();

    await prisma.user.update({
      where: { id: userId },
      data: {
        pendingEmail: newEmail,
        emailChangeCodeOldHash: hashOtp(otpOld),
        emailChangeCodeNewHash: hashOtp(otpNew),
        emailChangeExpiry: new Date(Date.now() + EMAIL_CHANGE_TTL_MS),
      },
    });

    await Promise.all([
      sendEmailChangeCode(user.email, otpOld, true),
      sendEmailChangeCode(newEmail, otpNew, false),
    ]);

    return { flow: 'dual-otp' };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { pendingEmail: newEmail },
  });

  const result = await identityVerification.initiateVerification(userId, 'email-change');
  return {
    flow: 'identity-verification',
    verificationId: result.verificationId,
    method: result.method,
    metadata: result.metadata,
  };
}

export async function confirmEmailChange(
  userId: string,
  data: { codeOld?: string; codeNew?: string; verificationId?: string },
): Promise<{ email: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      pendingEmail: true,
      emailChangeCodeOldHash: true,
      emailChangeCodeNewHash: true,
      emailChangeExpiry: true,
    },
  });
  if (!user) throw new AppError('User not found', 404);
  if (!user.pendingEmail) throw new AppError('No pending email change.', 400);

  if (user.emailChangeCodeOldHash && user.emailChangeCodeNewHash) {
    // Dual-OTP flow
    if (!data.codeOld || !data.codeNew) {
      throw new AppError('Both verification codes are required.', 400);
    }
    if (user.emailChangeExpiry && user.emailChangeExpiry < new Date()) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          pendingEmail: null,
          emailChangeCodeOldHash: null,
          emailChangeCodeNewHash: null,
          emailChangeExpiry: null,
        },
      });
      throw new AppError('Verification codes have expired. Please start again.', 400);
    }

    const oldValid = timingSafeEqual(hashOtp(data.codeOld), user.emailChangeCodeOldHash);
    const newValid = timingSafeEqual(hashOtp(data.codeNew), user.emailChangeCodeNewHash);

    if (!oldValid || !newValid) {
      throw new AppError('Invalid verification code(s).', 400);
    }
  } else if (data.verificationId) {
    // Identity verification flow
    identityVerification.consumeVerification(data.verificationId, userId, 'email-change');
  } else {
    throw new AppError('Invalid confirmation payload.', 400);
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      email: user.pendingEmail,
      emailVerified: true,
      pendingEmail: null,
      emailChangeCodeOldHash: null,
      emailChangeCodeNewHash: null,
      emailChangeExpiry: null,
    },
    select: { email: true },
  });

  return { email: updated.email };
}

// ---------------------------------------------------------------------------
// Password Change
// ---------------------------------------------------------------------------

export async function initiatePasswordChange(userId: string): Promise<{
  skipVerification: boolean;
  verificationId?: string;
  method?: string;
  metadata?: Record<string, unknown>;
}> {
  const result = await identityVerification.initiateVerification(userId, 'password-change');

  if (result.method === 'password') {
    return { skipVerification: true };
  }

  return {
    skipVerification: false,
    verificationId: result.verificationId,
    method: result.method,
    metadata: result.metadata,
  };
}

export async function changePassword(
  userId: string,
  oldPassword: string,
  newPassword: string,
  verificationId?: string,
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('User not found', 404);

  if (!user.passwordHash) {
    throw new AppError('Cannot change password for OAuth-only accounts.', 400);
  }

  if (!user.vaultSalt || !user.encryptedVaultKey || !user.vaultKeyIV || !user.vaultKeyTag) {
    throw new AppError('Vault is not set up.', 400);
  }

  let masterKey: Buffer;

  if (verificationId) {
    // Identity was verified via a non-password method — consume verification
    identityVerification.consumeVerification(verificationId, userId, 'password-change');

    // Get master key from in-memory vault session (already unlocked)
    const sessionKey = await getMasterKey(userId);
    if (!sessionKey) throw new AppError('Vault is locked. Please unlock it first.', 403);
    masterKey = Buffer.from(sessionKey);
  } else {
    // Standard flow: verify old password
    const valid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!valid) throw new AppError('Current password is incorrect', 401);

    const oldDerivedKey = await deriveKeyFromPassword(oldPassword, user.vaultSalt);
    masterKey = decryptMasterKey(
      {
        ciphertext: user.encryptedVaultKey,
        iv: user.vaultKeyIV,
        tag: user.vaultKeyTag,
      },
      oldDerivedKey,
    );
    oldDerivedKey.fill(0);
  }

  // Check password against known data breaches (HIBP k-Anonymity)
  await assertPasswordNotBreached(newPassword);

  const newPasswordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  const newVaultSalt = generateSalt();
  const newDerivedKey = await deriveKeyFromPassword(newPassword, newVaultSalt);
  const newEncryptedVault = encryptMasterKey(masterKey, newDerivedKey);

  const newRecoveryKey = generateRecoveryKey();
  const recoveryEncrypted = await encryptMasterKeyWithRecovery(masterKey, newRecoveryKey);

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: newPasswordHash,
      vaultSalt: newVaultSalt,
      encryptedVaultKey: newEncryptedVault.ciphertext,
      vaultKeyIV: newEncryptedVault.iv,
      vaultKeyTag: newEncryptedVault.tag,
      encryptedVaultRecoveryKey: recoveryEncrypted.encrypted.ciphertext,
      vaultRecoveryKeyIV: recoveryEncrypted.encrypted.iv,
      vaultRecoveryKeyTag: recoveryEncrypted.encrypted.tag,
      vaultRecoveryKeySalt: recoveryEncrypted.salt,
    },
  });

  masterKey.fill(0);
  newDerivedKey.fill(0);

  lockVault(userId);
  await prisma.refreshToken.deleteMany({ where: { userId } });

  return { success: true, recoveryKey: newRecoveryKey };
}

export async function updateSshDefaults(userId: string, sshDefaults: Prisma.InputJsonValue) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { sshDefaults },
    select: { id: true, sshDefaults: true },
  });
  return user;
}

export async function updateRdpDefaults(userId: string, rdpDefaults: Prisma.InputJsonValue) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { rdpDefaults },
    select: { id: true, rdpDefaults: true },
  });
  return user;
}

export async function uploadAvatar(userId: string, avatarData: string) {
  if (!avatarData.startsWith('data:image/')) {
    throw new AppError('Invalid image format', 400);
  }
  if (avatarData.length > MAX_AVATAR_SIZE) {
    throw new AppError('Avatar image too large (max 200KB)', 400);
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: { avatarData },
    select: { id: true, avatarData: true },
  });

  return user;
}

export async function searchUsers(
  currentUserId: string,
  tenantId: string,
  query: string,
  scope?: 'tenant' | 'team',
  teamId?: string
) {
  const where: Prisma.UserWhereInput = {
    tenantMemberships: { some: { tenantId, status: 'ACCEPTED' } },
    id: { not: currentUserId },
    OR: [
      { email: { contains: query, mode: 'insensitive' } },
      { username: { contains: query, mode: 'insensitive' } },
    ],
  };

  if (scope === 'team') {
    if (!teamId) {
      // Safety: if team-scoped but no teamId provided, return empty to prevent
      // falling through to tenant-wide results (security bypass).
      return [];
    }
    where.teamMembers = { some: { teamId } };
  }

  const users = await prisma.user.findMany({
    where,
    select: { id: true, email: true, username: true, avatarData: true },
    take: 10,
    orderBy: { email: 'asc' },
  });

  return users;
}
