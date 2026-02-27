import prisma from '../lib/prisma';
import { OAuthProfile } from '../config/passport';
import { AppError } from '../middleware/error.middleware';
import {
  generateSalt,
  generateMasterKey,
  deriveKeyFromPassword,
  encryptMasterKey,
  storeVaultSession,
} from './crypto.service';

interface FindOrCreateResult {
  user: {
    id: string;
    email: string;
    username: string | null;
    avatarData: string | null;
    vaultSetupComplete: boolean;
    tenantId: string | null;
    tenantRole: string | null;
  };
  isNewUser: boolean;
}

export async function findOrCreateOAuthUser(
  profile: OAuthProfile,
  oauthTokens: { accessToken: string; refreshToken?: string }
): Promise<FindOrCreateResult> {
  // 1. Check for existing OAuth link
  const existingOAuth = await prisma.oAuthAccount.findUnique({
    where: {
      provider_providerUserId: {
        provider: profile.provider,
        providerUserId: profile.providerUserId,
      },
    },
    include: {
      user: {
        select: {
          id: true, email: true, username: true, avatarData: true,
          vaultSetupComplete: true, tenantId: true, tenantRole: true,
        },
      },
    },
  });

  if (existingOAuth) {
    // Update stored OAuth tokens
    await prisma.oAuthAccount.update({
      where: { id: existingOAuth.id },
      data: {
        accessToken: oauthTokens.accessToken,
        refreshToken: oauthTokens.refreshToken ?? existingOAuth.refreshToken,
        providerEmail: profile.email,
      },
    });

    return { user: existingOAuth.user, isNewUser: false };
  }

  // 2. No existing OAuth link — check if a user with this email already exists
  const existingUser = await prisma.user.findUnique({
    where: { email: profile.email },
    select: {
      id: true, email: true, username: true, avatarData: true,
      vaultSetupComplete: true, tenantId: true, tenantRole: true,
    },
  });

  if (existingUser) {
    // Auto-link: existing user gains a new OAuth account
    await prisma.oAuthAccount.create({
      data: {
        userId: existingUser.id,
        provider: profile.provider,
        providerUserId: profile.providerUserId,
        providerEmail: profile.email,
        accessToken: oauthTokens.accessToken,
        refreshToken: oauthTokens.refreshToken,
      },
    });

    return { user: existingUser, isNewUser: false };
  }

  // 3. Brand new user — create User + OAuthAccount in a transaction
  const newUser = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: profile.email,
        username: profile.displayName,
        passwordHash: null,
        vaultSalt: null,
        encryptedVaultKey: null,
        vaultKeyIV: null,
        vaultKeyTag: null,
        vaultSetupComplete: false,
        emailVerified: true, // OAuth emails are pre-verified by the provider
      },
      select: {
        id: true, email: true, username: true, avatarData: true,
        vaultSetupComplete: true, tenantId: true, tenantRole: true,
      },
    });

    await tx.oAuthAccount.create({
      data: {
        userId: user.id,
        provider: profile.provider,
        providerUserId: profile.providerUserId,
        providerEmail: profile.email,
        accessToken: oauthTokens.accessToken,
        refreshToken: oauthTokens.refreshToken,
      },
    });

    return user;
  });

  return { user: newUser, isNewUser: true };
}

export async function linkOAuthAccount(
  userId: string,
  profile: OAuthProfile,
  oauthTokens: { accessToken: string; refreshToken?: string }
): Promise<void> {
  // Check if this provider account is already linked to someone else
  const existing = await prisma.oAuthAccount.findUnique({
    where: {
      provider_providerUserId: {
        provider: profile.provider,
        providerUserId: profile.providerUserId,
      },
    },
  });

  if (existing) {
    if (existing.userId === userId) {
      return; // Already linked to this user
    }
    throw new AppError('This OAuth account is already linked to a different user.', 409);
  }

  // Check if user already has an account with this provider
  const existingForProvider = await prisma.oAuthAccount.findFirst({
    where: { userId, provider: profile.provider },
  });

  if (existingForProvider) {
    throw new AppError(`You already have a ${profile.provider} account linked.`, 409);
  }

  await prisma.oAuthAccount.create({
    data: {
      userId,
      provider: profile.provider,
      providerUserId: profile.providerUserId,
      providerEmail: profile.email,
      accessToken: oauthTokens.accessToken,
      refreshToken: oauthTokens.refreshToken,
    },
  });
}

export async function unlinkOAuthAccount(
  userId: string,
  provider: string
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user) throw new AppError('User not found', 404);

  const oauthAccounts = await prisma.oAuthAccount.findMany({
    where: { userId },
  });

  const targetAccount = oauthAccounts.find((a) => a.provider === provider);
  if (!targetAccount) {
    throw new AppError('OAuth account not found', 404);
  }

  // Safety: cannot unlink if it's the only auth method
  const hasPassword = !!user.passwordHash;
  const otherOauthCount = oauthAccounts.length - 1;

  if (!hasPassword && otherOauthCount === 0) {
    throw new AppError(
      'Cannot unlink your only sign-in method. Set a password first or link another OAuth provider.',
      400
    );
  }

  await prisma.oAuthAccount.delete({ where: { id: targetAccount.id } });
}

export async function getLinkedAccounts(userId: string) {
  return prisma.oAuthAccount.findMany({
    where: { userId },
    select: {
      id: true,
      provider: true,
      providerEmail: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });
}

export async function setupVaultForOAuthUser(
  userId: string,
  vaultPassword: string
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('User not found', 404);

  if (user.vaultSetupComplete) {
    throw new AppError('Vault is already set up.', 400);
  }

  // Generate vault encryption (same logic as register in auth.service.ts)
  const vaultSalt = generateSalt();
  const masterKey = generateMasterKey();
  const derivedKey = await deriveKeyFromPassword(vaultPassword, vaultSalt);
  const encryptedVault = encryptMasterKey(masterKey, derivedKey);

  await prisma.user.update({
    where: { id: userId },
    data: {
      vaultSalt,
      encryptedVaultKey: encryptedVault.ciphertext,
      vaultKeyIV: encryptedVault.iv,
      vaultKeyTag: encryptedVault.tag,
      vaultSetupComplete: true,
    },
  });

  // Immediately unlock the vault
  storeVaultSession(userId, masterKey);

  // Zero out sensitive data
  masterKey.fill(0);
  derivedKey.fill(0);
}
