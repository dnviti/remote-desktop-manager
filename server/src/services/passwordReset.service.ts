import crypto from 'crypto';
import bcrypt from 'bcrypt';
import prisma from '../lib/prisma';
import { logger } from '../utils/logger';
import {
  hashToken,
  generateSalt,
  deriveKeyFromPassword,
  encryptMasterKey,
  decryptMasterKeyWithRecovery,
  encryptMasterKeyWithRecovery,
  generateRecoveryKey,
  lockVault,
} from './crypto.service';
import { sendPasswordResetEmail } from './email';
import * as auditService from './audit.service';
import { assertPasswordNotBreached } from './password.service';

const log = logger.child('password-reset');

const BCRYPT_ROUNDS = 12;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function maskPhone(phone: string): string {
  if (phone.length <= 4) return '****';
  return '*'.repeat(phone.length - 4) + phone.slice(-4);
}

export async function requestPasswordReset(
  email: string,
  ipAddress?: string | string[]
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      passwordHash: true,
      lockedUntil: true,
    },
  });

  // Silently no-op for non-existent, OAuth-only, or locked accounts (anti-enumeration)
  if (!user || !user.passwordHash) {
    log.debug('Password reset requested for unknown or OAuth-only email');
    return;
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    log.debug(`Password reset requested for locked account ${user.id}`);
    return;
  }

  // Generate secure token
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordResetTokenHash: tokenHash,
      passwordResetExpiry: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  });

  // Send email (fire-and-forget to not leak timing)
  sendPasswordResetEmail(email, token).catch((err) => {
    log.error('Failed to send password reset email:', err instanceof Error ? err.message : 'Unknown error');
  });

  auditService.log({
    userId: user.id,
    action: 'PASSWORD_RESET_REQUEST',
    details: { email },
    ipAddress,
  });

  log.verbose(`Password reset requested for user ${user.id}`);
}

export async function validateResetToken(token: string): Promise<{
  valid: boolean;
  requiresSmsVerification: boolean;
  maskedPhone?: string;
  hasRecoveryKey: boolean;
}> {
  const tokenHash = hashToken(token);

  const user = await prisma.user.findUnique({
    where: { passwordResetTokenHash: tokenHash },
    select: {
      id: true,
      passwordResetExpiry: true,
      smsMfaEnabled: true,
      phoneVerified: true,
      phoneNumber: true,
      encryptedVaultRecoveryKey: true,
    },
  });

  if (!user || !user.passwordResetExpiry || user.passwordResetExpiry < new Date()) {
    return { valid: false, requiresSmsVerification: false, hasRecoveryKey: false };
  }

  const requiresSms = !!(user.smsMfaEnabled && user.phoneVerified && user.phoneNumber);

  return {
    valid: true,
    requiresSmsVerification: requiresSms,
    maskedPhone: requiresSms && user.phoneNumber ? maskPhone(user.phoneNumber) : undefined,
    hasRecoveryKey: !!user.encryptedVaultRecoveryKey,
  };
}

export async function requestResetSmsCode(token: string): Promise<void> {
  const tokenHash = hashToken(token);

  const user = await prisma.user.findUnique({
    where: { passwordResetTokenHash: tokenHash },
    select: {
      id: true,
      passwordResetExpiry: true,
      smsMfaEnabled: true,
      phoneVerified: true,
      phoneNumber: true,
    },
  });

  if (!user || !user.passwordResetExpiry || user.passwordResetExpiry < new Date()) {
    throw new Error('Invalid or expired reset token');
  }

  if (!user.smsMfaEnabled || !user.phoneVerified || !user.phoneNumber) {
    throw new Error('SMS MFA is not available for this account');
  }

  const { sendOtpToPhone } = await import('./smsOtp.service');
  await sendOtpToPhone(user.id, user.phoneNumber);
}

export async function completePasswordReset(params: {
  token: string;
  newPassword: string;
  smsCode?: string;
  recoveryKey?: string;
  ipAddress?: string | string[];
}): Promise<{ success: boolean; vaultPreserved: boolean; newRecoveryKey?: string }> {
  const { token, newPassword, smsCode, recoveryKey, ipAddress } = params;
  const tokenHash = hashToken(token);

  const user = await prisma.user.findUnique({
    where: { passwordResetTokenHash: tokenHash },
  });

  if (!user || !user.passwordResetExpiry || user.passwordResetExpiry < new Date()) {
    auditService.log({
      action: 'PASSWORD_RESET_FAILURE',
      details: { reason: 'invalid_or_expired_token' },
      ipAddress,
    });
    throw new Error('Invalid or expired reset token');
  }

  // Verify SMS OTP if required
  if (user.smsMfaEnabled && user.phoneVerified && user.phoneNumber) {
    if (!smsCode) {
      throw new Error('SMS verification code is required');
    }
    const { verifyOtp } = await import('./smsOtp.service');
    const valid = await verifyOtp(user.id, smsCode);
    if (!valid) {
      auditService.log({
        userId: user.id,
        action: 'PASSWORD_RESET_FAILURE',
        details: { reason: 'invalid_sms_code' },
        ipAddress,
      });
      throw new Error('Invalid or expired SMS code');
    }
  }

  // Check password against known data breaches (HIBP k-Anonymity)
  await assertPasswordNotBreached(newPassword);

  // Hash new password
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  let vaultPreserved = false;
  let newRecoveryKeyValue: string | undefined;

  // Vault re-keying
  if (
    recoveryKey &&
    user.encryptedVaultRecoveryKey &&
    user.vaultRecoveryKeyIV &&
    user.vaultRecoveryKeyTag &&
    user.vaultRecoveryKeySalt
  ) {
    try {
      // Decrypt master key with recovery key
      const masterKey = await decryptMasterKeyWithRecovery(
        {
          ciphertext: user.encryptedVaultRecoveryKey,
          iv: user.vaultRecoveryKeyIV,
          tag: user.vaultRecoveryKeyTag,
        },
        recoveryKey,
        user.vaultRecoveryKeySalt
      );

      // Re-encrypt master key with new password
      const newVaultSalt = generateSalt();
      const newDerivedKey = await deriveKeyFromPassword(newPassword, newVaultSalt);
      const newEncryptedVault = encryptMasterKey(masterKey, newDerivedKey);

      // Generate new recovery key
      newRecoveryKeyValue = generateRecoveryKey();
      const newRecovery = await encryptMasterKeyWithRecovery(masterKey, newRecoveryKeyValue);

      // Zero sensitive data
      masterKey.fill(0);
      newDerivedKey.fill(0);

      // Update user with preserved vault
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          vaultSalt: newVaultSalt,
          encryptedVaultKey: newEncryptedVault.ciphertext,
          vaultKeyIV: newEncryptedVault.iv,
          vaultKeyTag: newEncryptedVault.tag,
          encryptedVaultRecoveryKey: newRecovery.encrypted.ciphertext,
          vaultRecoveryKeyIV: newRecovery.encrypted.iv,
          vaultRecoveryKeyTag: newRecovery.encrypted.tag,
          vaultRecoveryKeySalt: newRecovery.salt,
          vaultNeedsRecovery: false,
          passwordResetTokenHash: null,
          passwordResetExpiry: null,
        },
      });

      vaultPreserved = true;
      log.verbose(`Password reset with vault preservation for user ${user.id}`);
    } catch (err) {
      log.warn(`Recovery key decryption failed for user ${user.id}:`, err);
      // Fall through to vault reset
    }
  }

  if (!vaultPreserved) {
    // Element/Matrix-style: NEVER auto-wipe encrypted data.
    // Mark vault as "awaiting recovery" — the user can provide the recovery
    // key at any time (from Keychain) to restore access.
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        vaultNeedsRecovery: true,
        passwordResetTokenHash: null,
        passwordResetExpiry: null,
        // Note: encryptedVaultKey and all encrypted data are preserved.
        // They remain encrypted with the OLD master key. The user must
        // provide the recovery key to decrypt the old master key and
        // re-encrypt it with the new password-derived key.
      },
    });

    auditService.log({
      userId: user.id,
      action: 'VAULT_NEEDS_RECOVERY',
      details: { reason: 'password_reset_without_recovery_key' },
      ipAddress,
    });

    log.verbose(`Password reset with vault pending recovery for user ${user.id}`);
  }

  // Invalidate all refresh tokens (force re-login on all devices)
  await prisma.refreshToken.deleteMany({
    where: { userId: user.id },
  });

  // Lock vault in memory
  lockVault(user.id);

  auditService.log({
    userId: user.id,
    action: 'PASSWORD_RESET_COMPLETE',
    details: { vaultPreserved },
    ipAddress,
  });

  return {
    success: true,
    vaultPreserved,
    newRecoveryKey: newRecoveryKeyValue,
  };
}
