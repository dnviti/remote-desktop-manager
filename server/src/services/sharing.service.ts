import prisma, { Permission } from '../lib/prisma';
import { encrypt, decrypt, getMasterKey } from './crypto.service';
import { AppError } from '../middleware/error.middleware';
import { createNotificationAsync } from './notification.service';
import { emitNotification } from '../socket/notification.handler';

export async function shareConnection(
  ownerUserId: string,
  connectionId: string,
  targetEmail: string,
  permission: Permission
) {
  const ownerKey = getMasterKey(ownerUserId);
  if (!ownerKey) throw new AppError('Vault is locked', 403);

  const connection = await prisma.connection.findFirst({
    where: { id: connectionId, userId: ownerUserId },
  });
  if (!connection) throw new AppError('Connection not found', 404);

  const targetUser = await prisma.user.findUnique({
    where: { email: targetEmail },
  });
  if (!targetUser) throw new AppError('User not found', 404);
  if (targetUser.id === ownerUserId) {
    throw new AppError('Cannot share with yourself', 400);
  }

  // Get target user's master key (they must have their vault unlocked)
  const targetKey = getMasterKey(targetUser.id);
  if (!targetKey) {
    throw new AppError(
      'Target user vault is locked. They must be logged in to receive shares.',
      400
    );
  }

  // Decrypt credentials with owner's key
  const username = decrypt(
    {
      ciphertext: connection.encryptedUsername,
      iv: connection.usernameIV,
      tag: connection.usernameTag,
    },
    ownerKey
  );
  const password = decrypt(
    {
      ciphertext: connection.encryptedPassword,
      iv: connection.passwordIV,
      tag: connection.passwordTag,
    },
    ownerKey
  );

  // Re-encrypt with target user's key
  const encUsername = encrypt(username, targetKey);
  const encPassword = encrypt(password, targetKey);

  const shared = await prisma.sharedConnection.upsert({
    where: {
      connectionId_sharedWithUserId: {
        connectionId,
        sharedWithUserId: targetUser.id,
      },
    },
    create: {
      connectionId,
      sharedWithUserId: targetUser.id,
      sharedByUserId: ownerUserId,
      permission,
      encryptedUsername: encUsername.ciphertext,
      usernameIV: encUsername.iv,
      usernameTag: encUsername.tag,
      encryptedPassword: encPassword.ciphertext,
      passwordIV: encPassword.iv,
      passwordTag: encPassword.tag,
    },
    update: {
      permission,
      encryptedUsername: encUsername.ciphertext,
      usernameIV: encUsername.iv,
      usernameTag: encUsername.tag,
      encryptedPassword: encPassword.ciphertext,
      passwordIV: encPassword.iv,
      passwordTag: encPassword.tag,
    },
  });

  // Notify target user
  const owner = await prisma.user.findUnique({
    where: { id: ownerUserId },
    select: { username: true, email: true },
  });
  const ownerName = owner?.username || owner?.email || 'Someone';
  const msg = `${ownerName} shared "${connection.name}" with you (${permission === 'FULL_ACCESS' ? 'Full Access' : 'Read Only'})`;

  createNotificationAsync({
    userId: targetUser.id,
    type: 'CONNECTION_SHARED',
    message: msg,
    relatedId: connectionId,
  });

  // Real-time push
  emitNotification(targetUser.id, {
    id: shared.id,
    type: 'CONNECTION_SHARED',
    message: msg,
    read: false,
    relatedId: connectionId,
    createdAt: new Date(),
  });

  return {
    id: shared.id,
    permission: shared.permission,
    sharedWith: targetEmail,
  };
}

export async function unshareConnection(
  ownerUserId: string,
  connectionId: string,
  targetUserId: string
) {
  const connection = await prisma.connection.findFirst({
    where: { id: connectionId, userId: ownerUserId },
  });
  if (!connection) throw new AppError('Connection not found', 404);

  await prisma.sharedConnection.deleteMany({
    where: { connectionId, sharedWithUserId: targetUserId },
  });

  // Notify target user
  const owner = await prisma.user.findUnique({
    where: { id: ownerUserId },
    select: { username: true, email: true },
  });
  const ownerName = owner?.username || owner?.email || 'Someone';
  const msg = `${ownerName} revoked your access to "${connection.name}"`;

  createNotificationAsync({
    userId: targetUserId,
    type: 'SHARE_REVOKED',
    message: msg,
    relatedId: connectionId,
  });
  emitNotification(targetUserId, {
    id: '',
    type: 'SHARE_REVOKED',
    message: msg,
    read: false,
    relatedId: connectionId,
    createdAt: new Date(),
  });

  return { deleted: true };
}

export async function updateSharePermission(
  ownerUserId: string,
  connectionId: string,
  targetUserId: string,
  permission: Permission
) {
  const connection = await prisma.connection.findFirst({
    where: { id: connectionId, userId: ownerUserId },
  });
  if (!connection) throw new AppError('Connection not found', 404);

  const shared = await prisma.sharedConnection.findFirst({
    where: { connectionId, sharedWithUserId: targetUserId },
  });
  if (!shared) throw new AppError('Share not found', 404);

  const result = await prisma.sharedConnection.update({
    where: { id: shared.id },
    data: { permission },
  });

  // Notify target user
  const owner = await prisma.user.findUnique({
    where: { id: ownerUserId },
    select: { username: true, email: true },
  });
  const ownerName = owner?.username || owner?.email || 'Someone';
  const permLabel = permission === 'FULL_ACCESS' ? 'Full Access' : 'Read Only';
  const msg = `${ownerName} changed your permission on "${connection.name}" to ${permLabel}`;

  createNotificationAsync({
    userId: targetUserId,
    type: 'SHARE_PERMISSION_UPDATED',
    message: msg,
    relatedId: connectionId,
  });
  emitNotification(targetUserId, {
    id: '',
    type: 'SHARE_PERMISSION_UPDATED',
    message: msg,
    read: false,
    relatedId: connectionId,
    createdAt: new Date(),
  });

  return result;
}

export async function listShares(ownerUserId: string, connectionId: string) {
  const connection = await prisma.connection.findFirst({
    where: { id: connectionId, userId: ownerUserId },
  });
  if (!connection) throw new AppError('Connection not found', 404);

  const shares = await prisma.sharedConnection.findMany({
    where: { connectionId },
    include: { sharedWith: { select: { id: true, email: true } } },
  });

  return shares.map((s: (typeof shares)[number]) => ({
    id: s.id,
    userId: s.sharedWith.id,
    email: s.sharedWith.email,
    permission: s.permission,
    createdAt: s.createdAt,
  }));
}
