import crypto from 'crypto';
import prisma from '../lib/prisma';
import { AppError } from '../middleware/error.middleware';
import {
  encrypt,
  decrypt,
  generateSalt,
  hashToken,
  deriveKeyFromToken,
  deriveKeyFromTokenAndPin,
} from './crypto.service';
import { resolveSecretEncryptionKey } from './secret.service';
import * as permissionService from './permission.service';
import * as auditService from './audit.service';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface CreateExternalShareInput {
  expiresInMinutes: number;
  maxAccessCount?: number;
  pin?: string;
}

export interface ExternalShareResult {
  id: string;
  shareUrl: string;
  expiresAt: string;
  maxAccessCount: number | null;
  hasPin: boolean;
}

export interface ExternalShareInfo {
  id: string;
  secretName: string;
  secretType: string;
  hasPin: boolean;
  expiresAt: string;
  isExpired: boolean;
  isExhausted: boolean;
  isRevoked: boolean;
}

export interface ExternalShareListItem {
  id: string;
  secretName: string;
  secretType: string;
  hasPin: boolean;
  expiresAt: string;
  maxAccessCount: number | null;
  accessCount: number;
  isRevoked: boolean;
  createdAt: string;
}

export async function createExternalShare(
  userId: string,
  secretId: string,
  input: CreateExternalShareInput,
  tenantId?: string | null,
): Promise<ExternalShareResult> {
  // 1. Permission check
  const access = await permissionService.canManageSecret(userId, secretId, tenantId);
  if (!access.allowed) {
    throw new AppError('You do not have permission to share this secret', 403);
  }

  const secret = access.secret;

  // 2. Resolve encryption key and decrypt secret data
  const encryptionKey = await resolveSecretEncryptionKey(
    userId,
    secret.scope,
    secret.teamId,
    secret.tenantId,
  );
  const decryptedJson = decrypt(
    { ciphertext: secret.encryptedData, iv: secret.dataIV, tag: secret.dataTag },
    encryptionKey,
  );

  // 3. Generate token and compute hash
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenDigest = hashToken(rawToken);

  // 4. Generate share ID upfront (needed for HKDF info param)
  const shareId = crypto.randomUUID();

  // 5. Derive encryption key for the share
  let derivedKey: Buffer;
  let pinSalt: string | null = null;
  const hasPin = !!input.pin;

  if (input.pin) {
    pinSalt = generateSalt();
    derivedKey = await deriveKeyFromTokenAndPin(rawToken, input.pin, pinSalt);
  } else {
    derivedKey = await deriveKeyFromToken(rawToken, shareId);
  }

  // 6. Re-encrypt the secret data with the derived key
  const encrypted = encrypt(decryptedJson, derivedKey);
  derivedKey.fill(0);

  // 7. Calculate expiry
  const expiresAt = new Date(Date.now() + input.expiresInMinutes * 60 * 1000);

  // 8. Save to database
  const share = await prisma.externalSecretShare.create({
    data: {
      id: shareId,
      secretId,
      createdByUserId: userId,
      tokenHash: tokenDigest,
      encryptedData: encrypted.ciphertext,
      dataIV: encrypted.iv,
      dataTag: encrypted.tag,
      hasPin,
      pinSalt,
      expiresAt,
      maxAccessCount: input.maxAccessCount ?? null,
      secretType: secret.type,
      secretName: secret.name,
    },
  });

  // 9. Audit log
  auditService.log({
    userId,
    action: 'SECRET_EXTERNAL_SHARE',
    targetType: 'VaultSecret',
    targetId: secretId,
    details: {
      shareId: share.id,
      hasPin,
      expiresAt: expiresAt.toISOString(),
      maxAccessCount: input.maxAccessCount ?? null,
    },
  });

  return {
    id: share.id,
    shareUrl: `${config.clientUrl}/share/${rawToken}`,
    expiresAt: expiresAt.toISOString(),
    maxAccessCount: input.maxAccessCount ?? null,
    hasPin,
  };
}

export async function getExternalShareInfo(token: string): Promise<ExternalShareInfo> {
  const tokenDigest = hashToken(token);
  const share = await prisma.externalSecretShare.findUnique({
    where: { tokenHash: tokenDigest },
  });

  if (!share) {
    throw new AppError('Share not found', 404);
  }

  const now = new Date();
  return {
    id: share.id,
    secretName: share.secretName,
    secretType: share.secretType,
    hasPin: share.hasPin,
    expiresAt: share.expiresAt.toISOString(),
    isExpired: share.expiresAt < now,
    isExhausted: share.maxAccessCount !== null && share.accessCount >= share.maxAccessCount,
    isRevoked: share.isRevoked,
  };
}

export async function accessExternalShare(
  token: string,
  pin?: string,
  ipAddress?: string,
) {
  const tokenDigest = hashToken(token);
  const share = await prisma.externalSecretShare.findUnique({
    where: { tokenHash: tokenDigest },
  });

  if (!share) {
    throw new AppError('Share not found', 404);
  }

  if (share.isRevoked) {
    throw new AppError('This share has been revoked', 410);
  }

  if (share.expiresAt < new Date()) {
    throw new AppError('This share has expired', 410);
  }

  if (share.maxAccessCount !== null && share.accessCount >= share.maxAccessCount) {
    throw new AppError('Access limit reached', 410);
  }

  if (share.hasPin && !pin) {
    throw new AppError('PIN is required', 400);
  }

  // Derive decryption key
  let derivedKey: Buffer;
  try {
    if (share.hasPin) {
      derivedKey = await deriveKeyFromTokenAndPin(token, pin!, share.pinSalt!);
    } else {
      derivedKey = await deriveKeyFromToken(token, share.id);
    }
  } catch {
    throw new AppError('Failed to derive decryption key', 500);
  }

  // Decrypt the data
  let decryptedJson: string;
  try {
    decryptedJson = decrypt(
      { ciphertext: share.encryptedData, iv: share.dataIV, tag: share.dataTag },
      derivedKey,
    );
  } catch {
    throw new AppError('Invalid PIN or corrupted data', 403);
  } finally {
    derivedKey.fill(0);
  }

  // Increment access count
  await prisma.externalSecretShare.update({
    where: { id: share.id },
    data: { accessCount: { increment: 1 } },
  });

  // Audit log (no userId for public access)
  auditService.log({
    userId: null,
    action: 'SECRET_EXTERNAL_ACCESS',
    targetType: 'ExternalSecretShare',
    targetId: share.id,
    details: {
      secretId: share.secretId,
      secretName: share.secretName,
    },
    ipAddress,
  });

  return {
    secretName: share.secretName,
    secretType: share.secretType,
    data: JSON.parse(decryptedJson),
  };
}

export async function revokeExternalShare(
  userId: string,
  shareId: string,
  tenantId?: string | null,
): Promise<void> {
  const share = await prisma.externalSecretShare.findUnique({
    where: { id: shareId },
  });

  if (!share) {
    throw new AppError('Share not found', 404);
  }

  // Permission check on the parent secret
  const access = await permissionService.canManageSecret(userId, share.secretId, tenantId);
  if (!access.allowed) {
    throw new AppError('You do not have permission to revoke this share', 403);
  }

  await prisma.externalSecretShare.update({
    where: { id: shareId },
    data: { isRevoked: true },
  });

  auditService.log({
    userId,
    action: 'SECRET_EXTERNAL_REVOKE',
    targetType: 'ExternalSecretShare',
    targetId: shareId,
    details: { secretId: share.secretId },
  });
}

export async function listExternalShares(
  userId: string,
  secretId: string,
  tenantId?: string | null,
): Promise<ExternalShareListItem[]> {
  const access = await permissionService.canManageSecret(userId, secretId, tenantId);
  if (!access.allowed) {
    throw new AppError('You do not have permission to view shares for this secret', 403);
  }

  const shares = await prisma.externalSecretShare.findMany({
    where: { secretId },
    orderBy: { createdAt: 'desc' },
  });

  return shares.map((s) => ({
    id: s.id,
    secretName: s.secretName,
    secretType: s.secretType,
    hasPin: s.hasPin,
    expiresAt: s.expiresAt.toISOString(),
    maxAccessCount: s.maxAccessCount,
    accessCount: s.accessCount,
    isRevoked: s.isRevoked,
    createdAt: s.createdAt.toISOString(),
  }));
}

export async function cleanupExpiredShares(): Promise<number> {
  const result = await prisma.externalSecretShare.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { isRevoked: true },
      ],
    },
  });

  if (result.count > 0) {
    logger.info(`External share cleanup: removed ${result.count} expired/revoked share(s)`);
  }

  return result.count;
}
