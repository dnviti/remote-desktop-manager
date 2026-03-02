import prisma from '../lib/prisma';
import {
  deriveKeyFromPassword,
  decryptMasterKey,
  storeVaultSession,
  lockVault as lockVaultSession,
  isVaultUnlocked as checkVaultUnlocked,
  getMasterKey,
  decrypt,
} from './crypto.service';
import { AppError } from '../middleware/error.middleware';

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

    storeVaultSession(userId, masterKey);
    masterKey.fill(0);
    derivedKey.fill(0);

    return { unlocked: true };
  } catch {
    throw new AppError('Invalid password', 401);
  }
}

export function lockVault(userId: string) {
  lockVaultSession(userId);
  return { unlocked: false };
}

export function getVaultStatus(userId: string) {
  return { unlocked: checkVaultUnlocked(userId) };
}

export async function revealPassword(
  userId: string,
  connectionId: string,
  password: string
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('User not found', 404);

  // Try to get master key from memory first
  let masterKey = getMasterKey(userId);

  // If vault is locked, derive from password
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
      storeVaultSession(userId, masterKey);
      derivedKey.fill(0);
    } catch {
      throw new AppError('Invalid password', 401);
    }
  }

  // Check if user owns the connection
  const connection = await prisma.connection.findFirst({
    where: { id: connectionId, userId },
  });

  if (connection) {
    // Vault-backed connection: resolve from secret
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

  // Check if it's a shared connection with FULL_ACCESS
  const shared = await prisma.sharedConnection.findFirst({
    where: {
      connectionId,
      sharedWithUserId: userId,
      permission: 'FULL_ACCESS',
    },
    include: { connection: { select: { credentialSecretId: true } } },
  });

  if (shared) {
    // Vault-backed shared connection: resolve from secret
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
