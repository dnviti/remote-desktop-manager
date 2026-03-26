import prisma from '../lib/prisma';
import { config } from '../config';
import bcrypt from 'bcrypt';
import {
  deriveKeyFromPassword,
  decryptMasterKey,
  storeVaultSession,
  storeVaultRecovery,
  softLockVault,
  isVaultUnlocked as checkVaultUnlocked,
  getMasterKey,
  getVaultRecovery,
  hasVaultRecovery,
  decrypt,
  generateMasterKey,
  generateSalt,
  encryptMasterKey,
  generateRecoveryKey,
  encryptMasterKeyWithRecovery,
  decryptMasterKeyWithRecovery,
} from './crypto.service';
import { verifyCode as verifyTotpCode, getDecryptedSecret } from './totp.service';
import { AppError } from '../middleware/error.middleware';
import { processPendingDistributions } from './secret.service';

// Resolve the effective vault auto-lock TTL for a user (in minutes, 0 = never)
async function resolveVaultTtl(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      vaultAutoLockMinutes: true,
      tenantMemberships: {
        where: { isActive: true },
        take: 1,
        include: { tenant: { select: { vaultAutoLockMaxMinutes: true, vaultDefaultTtlMinutes: true } } },
      },
    },
  });

  const userPref = user?.vaultAutoLockMinutes; // null = server default, 0 = never
  const tenantDefault = user?.tenantMemberships[0]?.tenant.vaultDefaultTtlMinutes; // null = no tenant default
  const tenantMax = user?.tenantMemberships[0]?.tenant.vaultAutoLockMaxMinutes; // null = no enforcement

  let effective = userPref ?? tenantDefault ?? config.vaultTtlMinutes;

  if (tenantMax !== null && tenantMax !== undefined) {
    if (effective === 0 && tenantMax > 0) {
      // User wants "never" but tenant enforces a max
      effective = tenantMax;
    } else if (tenantMax > 0 && effective > tenantMax) {
      // User TTL exceeds tenant max → clamp
      effective = tenantMax;
    }
  }

  return effective;
}

export async function unlockVault(userId: string, password: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('User not found', 404);

  if (!user.vaultSalt || !user.encryptedVaultKey || !user.vaultKeyIV || !user.vaultKeyTag) {
    throw new AppError('Vault not set up. Please set a vault password first.', 400);
  }

  try {
    const derivedKey = await deriveKeyFromPassword(password, user.vaultSalt);
    const masterKey = decryptMasterKey(
      {
        ciphertext: user.encryptedVaultKey,
        iv: user.vaultKeyIV,
        tag: user.vaultKeyTag,
      },
      derivedKey
    );

    const ttl = await resolveVaultTtl(userId);
    storeVaultSession(userId, masterKey, ttl);
    storeVaultRecovery(userId, masterKey);
    // Process any pending tenant vault key distributions
    processPendingDistributions(userId).catch(() => {/* non-blocking */});
    masterKey.fill(0);
    derivedKey.fill(0);

    return { unlocked: true };
  } catch {
    throw new AppError('Invalid password', 401);
  }
}

export function lockVault(userId: string) {
  softLockVault(userId);
  return { unlocked: false };
}

export async function getVaultStatus(userId: string) {
  const unlocked = checkVaultUnlocked(userId);
  const recoveryAvailable = hasVaultRecovery(userId);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      vaultNeedsRecovery: true,
      webauthnEnabled: true,
      totpEnabled: true,
      smsMfaEnabled: true,
    },
  });

  if (!recoveryAvailable || unlocked) {
    return {
      unlocked,
      vaultNeedsRecovery: user?.vaultNeedsRecovery ?? false,
      mfaUnlockAvailable: false,
      mfaUnlockMethods: [] as string[],
    };
  }

  const methods: string[] = [];
  if (user?.webauthnEnabled) methods.push('webauthn');
  if (user?.totpEnabled) methods.push('totp');
  if (user?.smsMfaEnabled) methods.push('sms');

  return {
    unlocked,
    vaultNeedsRecovery: user?.vaultNeedsRecovery ?? false,
    mfaUnlockAvailable: methods.length > 0,
    mfaUnlockMethods: methods,
  };
}

// MFA-based vault unlock

export async function unlockVaultWithTotp(userId: string, code: string) {
  const masterKey = getVaultRecovery(userId);
  if (!masterKey) throw new AppError('MFA vault recovery unavailable. Please use your password.', 403);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      totpEnabled: true,
      encryptedTotpSecret: true,
      totpSecretIV: true,
      totpSecretTag: true,
      totpSecret: true,
    },
  });
  if (!user || !user.totpEnabled) throw new AppError('TOTP is not enabled', 400);

  // Temporarily store so getDecryptedSecret can access the master key
  const ttl = await resolveVaultTtl(userId);
  storeVaultSession(userId, masterKey, ttl);
  const secret = getDecryptedSecret(user, userId);
  if (!secret) {
    softLockVault(userId);
    masterKey.fill(0);
    throw new AppError('Failed to decrypt TOTP secret', 500);
  }

  if (!verifyTotpCode(secret, code)) {
    softLockVault(userId);
    masterKey.fill(0);
    throw new AppError('Invalid TOTP code', 401);
  }

  processPendingDistributions(userId).catch(() => {/* non-blocking */});
  masterKey.fill(0);
  return { unlocked: true };
}

export async function requestVaultWebAuthnOptions(userId: string) {
  if (!hasVaultRecovery(userId)) {
    throw new AppError('MFA vault recovery unavailable. Please use your password.', 403);
  }

  const { generateAuthenticationOpts } = await import('./webauthn.service');
  return generateAuthenticationOpts(userId);
}

export async function unlockVaultWithWebAuthn(userId: string, credential: Record<string, unknown>) {
  if (!hasVaultRecovery(userId)) {
    throw new AppError('MFA vault recovery unavailable. Please use your password.', 403);
  }

  const { verifyAuthentication } = await import('./webauthn.service');
  await verifyAuthentication(userId, credential as unknown as Parameters<typeof verifyAuthentication>[1]);

  const masterKey = getVaultRecovery(userId);
  if (!masterKey) throw new AppError('MFA vault recovery unavailable. Please use your password.', 403);

  const ttl = await resolveVaultTtl(userId);
  storeVaultSession(userId, masterKey, ttl);
  processPendingDistributions(userId).catch(() => {/* non-blocking */});
  masterKey.fill(0);
  return { unlocked: true };
}

export async function requestVaultSmsCode(userId: string) {
  if (!hasVaultRecovery(userId)) {
    throw new AppError('MFA vault recovery unavailable. Please use your password.', 403);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { smsMfaEnabled: true, phoneNumber: true },
  });
  if (!user?.smsMfaEnabled || !user.phoneNumber) {
    throw new AppError('SMS MFA is not available', 400);
  }

  const { sendOtpToPhone } = await import('./smsOtp.service');
  await sendOtpToPhone(userId, user.phoneNumber);
}

export async function unlockVaultWithSms(userId: string, code: string) {
  const masterKey = getVaultRecovery(userId);
  if (!masterKey) throw new AppError('MFA vault recovery unavailable. Please use your password.', 403);

  const { verifyOtp } = await import('./smsOtp.service');
  const valid = await verifyOtp(userId, code);
  if (!valid) {
    masterKey.fill(0);
    throw new AppError('Invalid or expired SMS code', 401);
  }

  const ttl = await resolveVaultTtl(userId);
  storeVaultSession(userId, masterKey, ttl);
  processPendingDistributions(userId).catch(() => {/* non-blocking */});
  masterKey.fill(0);
  return { unlocked: true };
}

// Vault auto-lock preference

export async function getAutoLockPreference(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      vaultAutoLockMinutes: true,
      tenantMemberships: {
        where: { isActive: true },
        take: 1,
        include: { tenant: { select: { vaultAutoLockMaxMinutes: true } } },
      },
    },
  });

  const effective = await resolveVaultTtl(userId);

  return {
    autoLockMinutes: user?.vaultAutoLockMinutes ?? null,
    effectiveMinutes: effective,
    tenantMaxMinutes: user?.tenantMemberships[0]?.tenant.vaultAutoLockMaxMinutes ?? null,
  };
}

export async function setAutoLockPreference(userId: string, autoLockMinutes: number | null) {
  // Validate
  if (autoLockMinutes !== null && autoLockMinutes < 0) {
    throw new AppError('Auto-lock minutes must be 0 (never) or a positive number', 400);
  }

  // Check tenant enforcement
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      tenantMemberships: {
        where: { isActive: true },
        take: 1,
        include: { tenant: { select: { vaultAutoLockMaxMinutes: true } } },
      },
    },
  });
  const tenantMax = user?.tenantMemberships[0]?.tenant.vaultAutoLockMaxMinutes;
  if (tenantMax !== null && tenantMax !== undefined && tenantMax > 0) {
    if (autoLockMinutes === 0) {
      throw new AppError(`Your organization enforces a maximum vault auto-lock of ${tenantMax} minutes. "Never" is not allowed.`, 403);
    }
    if (autoLockMinutes !== null && autoLockMinutes > tenantMax) {
      throw new AppError(`Your organization enforces a maximum vault auto-lock of ${tenantMax} minutes.`, 403);
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: { vaultAutoLockMinutes: autoLockMinutes },
  });

  return { autoLockMinutes, effectiveMinutes: await resolveVaultTtl(userId) };
}

// Reveal password

export async function revealPassword(
  userId: string,
  connectionId: string,
  password: string
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('User not found', 404);

  let masterKey = getMasterKey(userId);

  if (!masterKey) {
    if (!user.vaultSalt || !user.encryptedVaultKey || !user.vaultKeyIV || !user.vaultKeyTag) {
      throw new AppError('Vault not set up. Please set a vault password first.', 400);
    }
    try {
      const derivedKey = await deriveKeyFromPassword(password, user.vaultSalt);
      masterKey = decryptMasterKey(
        {
          ciphertext: user.encryptedVaultKey,
          iv: user.vaultKeyIV,
          tag: user.vaultKeyTag,
        },
        derivedKey
      );
      const ttl = await resolveVaultTtl(userId);
      storeVaultSession(userId, masterKey, ttl);
      derivedKey.fill(0);
    } catch {
      throw new AppError('Invalid password', 401);
    }
  }

  const connection = await prisma.connection.findFirst({
    where: { id: connectionId, userId },
  });

  if (connection) {
    if (connection.credentialSecretId) {
      const { getConnectionCredentials } = await import('./connection.service');
      const creds = await getConnectionCredentials(userId, connectionId);
      return { password: creds.password };
    }
    if (!connection.encryptedPassword || !connection.passwordIV || !connection.passwordTag) {
      throw new AppError('Connection has no password configured', 400);
    }
    const decryptedPassword = decrypt(
      {
        ciphertext: connection.encryptedPassword,
        iv: connection.passwordIV,
        tag: connection.passwordTag,
      },
      masterKey
    );
    return { password: decryptedPassword };
  }

  const shared = await prisma.sharedConnection.findFirst({
    where: {
      connectionId,
      sharedWithUserId: userId,
      permission: 'FULL_ACCESS',
    },
    include: { connection: { select: { credentialSecretId: true } } },
  });

  if (shared) {
    if (shared.connection.credentialSecretId) {
      const { getConnectionCredentials } = await import('./connection.service');
      const creds = await getConnectionCredentials(userId, connectionId);
      return { password: creds.password };
    }
    if (shared.encryptedPassword && shared.passwordIV && shared.passwordTag) {
      const decryptedPassword = decrypt(
        {
          ciphertext: shared.encryptedPassword,
          iv: shared.passwordIV,
          tag: shared.passwordTag,
        },
        masterKey
      );
      return { password: decryptedPassword };
    }
  }

  throw new AppError('Connection not found or insufficient permissions', 403);
}

// Vault recovery after password reset

export async function getVaultRecoveryStatus(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      vaultNeedsRecovery: true,
      encryptedVaultRecoveryKey: true,
      vaultRecoveryKeyIV: true,
      vaultRecoveryKeyTag: true,
      vaultRecoveryKeySalt: true,
    },
  });
  if (!user) throw new AppError('User not found', 404);

  return {
    needsRecovery: user.vaultNeedsRecovery,
    hasRecoveryKey: !!(
      user.encryptedVaultRecoveryKey &&
      user.vaultRecoveryKeyIV &&
      user.vaultRecoveryKeyTag &&
      user.vaultRecoveryKeySalt
    ),
  };
}

export async function recoverVaultWithKey(
  userId: string,
  recoveryKey: string,
  currentPassword: string
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('User not found', 404);
  if (!user.vaultNeedsRecovery) {
    throw new AppError('Vault does not need recovery', 400);
  }
  if (
    !user.encryptedVaultRecoveryKey ||
    !user.vaultRecoveryKeyIV ||
    !user.vaultRecoveryKeyTag ||
    !user.vaultRecoveryKeySalt
  ) {
    throw new AppError('No recovery key available. You must reset your vault.', 400);
  }

  // Verify current password before proceeding
  if (!user.passwordHash) throw new AppError('No password set for this account', 400);
  const passwordValid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!passwordValid) throw new AppError('Invalid password', 401);

  // Decrypt old master key using the recovery key
  let masterKey: Buffer;
  try {
    masterKey = await decryptMasterKeyWithRecovery(
      {
        ciphertext: user.encryptedVaultRecoveryKey,
        iv: user.vaultRecoveryKeyIV,
        tag: user.vaultRecoveryKeyTag,
      },
      recoveryKey,
      user.vaultRecoveryKeySalt
    );
  } catch {
    throw new AppError('Invalid recovery key', 401);
  }

  // Derive new key from current password
  const newSalt = generateSalt();
  const derivedKey = await deriveKeyFromPassword(currentPassword, newSalt);

  // Re-encrypt master key with the new password-derived key
  const newEncryptedVault = encryptMasterKey(masterKey, derivedKey);

  // Generate a new recovery key
  const newRecoveryKeyPlain = generateRecoveryKey();
  const newRecovery = await encryptMasterKeyWithRecovery(masterKey, newRecoveryKeyPlain);

  // Update user in a transaction
  await prisma.user.update({
    where: { id: userId },
    data: {
      vaultSalt: newSalt,
      encryptedVaultKey: newEncryptedVault.ciphertext,
      vaultKeyIV: newEncryptedVault.iv,
      vaultKeyTag: newEncryptedVault.tag,
      encryptedVaultRecoveryKey: newRecovery.encrypted.ciphertext,
      vaultRecoveryKeyIV: newRecovery.encrypted.iv,
      vaultRecoveryKeyTag: newRecovery.encrypted.tag,
      vaultRecoveryKeySalt: newRecovery.salt,
      vaultNeedsRecovery: false,
    },
  });

  // Zero sensitive buffers
  masterKey.fill(0);
  derivedKey.fill(0);

  return { success: true, newRecoveryKey: newRecoveryKeyPlain };
}

export async function explicitVaultReset(userId: string, password: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('User not found', 404);

  // Verify current password
  if (!user.passwordHash) throw new AppError('No password set for this account', 400);
  const passwordValid = await bcrypt.compare(password, user.passwordHash);
  if (!passwordValid) throw new AppError('Invalid password', 401);

  // Generate fresh vault
  const masterKey = generateMasterKey();
  const newSalt = generateSalt();
  const derivedKey = await deriveKeyFromPassword(password, newSalt);
  const newEncryptedVault = encryptMasterKey(masterKey, derivedKey);

  // Generate new recovery key
  const newRecoveryKeyPlain = generateRecoveryKey();
  const newRecovery = await encryptMasterKeyWithRecovery(masterKey, newRecoveryKeyPlain);

  // Wipe all encrypted data and update vault in a transaction
  await prisma.$transaction(async (tx) => {
    // Update user vault fields
    await tx.user.update({
      where: { id: userId },
      data: {
        vaultSalt: newSalt,
        encryptedVaultKey: newEncryptedVault.ciphertext,
        vaultKeyIV: newEncryptedVault.iv,
        vaultKeyTag: newEncryptedVault.tag,
        encryptedVaultRecoveryKey: newRecovery.encrypted.ciphertext,
        vaultRecoveryKeyIV: newRecovery.encrypted.iv,
        vaultRecoveryKeyTag: newRecovery.encrypted.tag,
        vaultRecoveryKeySalt: newRecovery.salt,
        vaultNeedsRecovery: false,
        // Clear TOTP secrets
        encryptedTotpSecret: null,
        totpSecretIV: null,
        totpSecretTag: null,
        totpSecret: null,
        totpEnabled: false,
        // Clear encrypted domain password (master key changed)
        encryptedDomainPassword: null,
        domainPasswordIV: null,
        domainPasswordTag: null,
      },
    });

    // Wipe encrypted connection data
    await tx.connection.updateMany({
      where: { userId },
      data: {
        encryptedPassword: null,
        passwordIV: null,
        passwordTag: null,
        encryptedUsername: null,
        usernameIV: null,
        usernameTag: null,
        encryptedDomain: null,
        domainIV: null,
        domainTag: null,
      },
    });

    // Delete shared connections shared BY this user (recipients lose access)
    await tx.sharedConnection.deleteMany({
      where: { sharedByUserId: userId },
    });

    // Wipe shared connection encrypted data shared WITH this user
    await tx.sharedConnection.updateMany({
      where: { sharedWithUserId: userId },
      data: {
        encryptedPassword: null,
        passwordIV: null,
        passwordTag: null,
        encryptedUsername: null,
        usernameIV: null,
        usernameTag: null,
        encryptedDomain: null,
        domainIV: null,
        domainTag: null,
      },
    });

    // Delete vault secrets owned by this user
    await tx.vaultSecret.deleteMany({ where: { userId } });

    // Delete shared secrets created BY this user
    await tx.sharedSecret.deleteMany({ where: { sharedByUserId: userId } });

    // Delete shared secrets for this user
    await tx.sharedSecret.deleteMany({ where: { sharedWithUserId: userId } });

    // Delete external secret shares for secrets owned by this user
    await tx.externalSecretShare.deleteMany({
      where: { secret: { userId } },
    });

    // Remove tenant vault membership
    await tx.tenantVaultMember.deleteMany({ where: { userId } });
  });

  // Zero sensitive buffers
  masterKey.fill(0);
  derivedKey.fill(0);

  return { success: true, newRecoveryKey: newRecoveryKeyPlain };
}
