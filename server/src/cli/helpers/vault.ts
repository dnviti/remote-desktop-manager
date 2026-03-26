import { User } from '../../generated/prisma/client';
import { deriveKeyFromPassword, decryptMasterKey, storeVaultSession, getVaultSession } from '../../services/crypto.service';
import { resolveUser } from './resolve';
import { printError } from './output';

export async function unlockUserVault(identifier: string, password?: string): Promise<User | null> {
  const user = await resolveUser(identifier);
  if (!user) {
    printError(`User not found: ${identifier}`);
    return null;
  }

  // Already unlocked in memory?
  if (await getVaultSession(user.id)) {
    return user;
  }

  if (!password) {
    printError('User vault is locked. Please provide --password to unlock the vault for this operation.');
    return null;
  }

  if (!user.vaultSalt || !user.encryptedVaultKey || !user.vaultKeyIV || !user.vaultKeyTag) {
    printError('User vault encryption data is missing.');
    return null;
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
    storeVaultSession(user.id, masterKey);
    return user;
  } catch {
    printError('Failed to unlock vault (incorrect password or corrupted data).');
    return null;
  }
}
