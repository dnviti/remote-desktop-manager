import prisma, { Permission } from '../lib/prisma';
import { requireMasterKey, reEncryptField } from './crypto.service';
import { AppError } from '../middleware/error.middleware';
import { createNotificationAsync } from './notification.service';
import { emitNotification } from '../socket/notification.handler';
import { resolveSecretEncryptionKey } from './secret.service';
import * as permissionService from './permission.service';
import { assertShareableTenantBoundary } from '../utils/tenantScope';

export async function shareSecret(
  actingUserId: string,
  secretId: string,
  target: { email?: string; userId?: string },
  permission: Permission,
  tenantId?: string | null
) {
  const access = await permissionService.canManageSecret(actingUserId, secretId, tenantId);
  if (!access.allowed) throw new AppError('Secret not found', 404);

  const secret = access.secret;

  // For team secrets, only TEAM_ADMIN can share
  if (secret.teamId && access.teamRole !== 'TEAM_ADMIN') {
    throw new AppError('Only team admins can share team secrets', 403);
  }

  let targetUser;
  if (target.userId) {
    targetUser = await prisma.user.findUnique({ where: { id: target.userId } });
  } else if (target.email) {
    targetUser = await prisma.user.findUnique({ where: { email: target.email } });
  }
  if (!targetUser) throw new AppError('User not found', 404);
  if (targetUser.id === actingUserId) {
    throw new AppError('Cannot share with yourself', 400);
  }

  await assertShareableTenantBoundary(actingUserId, targetUser.id);

  const targetKey = requireMasterKey(targetUser.id, 'Unable to share with this user at this time.', 400);

  // Decrypt with scope-appropriate key and re-encrypt for target user
  const decryptionKey = await resolveSecretEncryptionKey(
    actingUserId,
    secret.scope,
    secret.teamId,
    secret.tenantId
  );

  const encData = reEncryptField(
    { ciphertext: secret.encryptedData, iv: secret.dataIV, tag: secret.dataTag },
    decryptionKey, targetKey
  );

  const shared = await prisma.sharedSecret.upsert({
    where: {
      secretId_sharedWithUserId: {
        secretId,
        sharedWithUserId: targetUser.id,
      },
    },
    create: {
      secretId,
      sharedWithUserId: targetUser.id,
      sharedByUserId: actingUserId,
      permission,
      encryptedData: encData.ciphertext,
      dataIV: encData.iv,
      dataTag: encData.tag,
    },
    update: {
      permission,
      encryptedData: encData.ciphertext,
      dataIV: encData.iv,
      dataTag: encData.tag,
    },
  });

  // Notify target user
  const actor = await prisma.user.findUnique({
    where: { id: actingUserId },
    select: { username: true, email: true },
  });
  const actorName = actor?.username || actor?.email || 'Someone';
  const permLabel = permission === 'FULL_ACCESS' ? 'Full Access' : 'Read Only';
  const msg = `${actorName} shared secret "${secret.name}" with you (${permLabel})`;

  createNotificationAsync({
    userId: targetUser.id,
    type: 'SECRET_SHARED',
    message: msg,
    relatedId: secretId,
  });

  emitNotification(targetUser.id, {
    id: shared.id,
    type: 'SECRET_SHARED',
    message: msg,
    read: false,
    relatedId: secretId,
    createdAt: new Date(),
  });

  return {
    id: shared.id,
    permission: shared.permission,
    sharedWith: targetUser.email,
  };
}

export async function unshareSecret(
  actingUserId: string,
  secretId: string,
  targetUserId: string,
  tenantId?: string | null
) {
  const access = await permissionService.canManageSecret(actingUserId, secretId, tenantId);
  if (!access.allowed) throw new AppError('Secret not found', 404);

  const secret = access.secret;

  // For team secrets, only TEAM_ADMIN can revoke shares
  if (secret.teamId && access.teamRole !== 'TEAM_ADMIN') {
    throw new AppError('Only team admins can revoke team secret shares', 403);
  }

  await prisma.sharedSecret.deleteMany({
    where: { secretId, sharedWithUserId: targetUserId },
  });

  // Notify target user
  const actor = await prisma.user.findUnique({
    where: { id: actingUserId },
    select: { username: true, email: true },
  });
  const actorName = actor?.username || actor?.email || 'Someone';
  const msg = `${actorName} revoked your access to secret "${secret.name}"`;

  createNotificationAsync({
    userId: targetUserId,
    type: 'SECRET_SHARE_REVOKED',
    message: msg,
    relatedId: secretId,
  });
  emitNotification(targetUserId, {
    id: '',
    type: 'SECRET_SHARE_REVOKED',
    message: msg,
    read: false,
    relatedId: secretId,
    createdAt: new Date(),
  });

  return { deleted: true };
}

export async function updateSecretSharePermission(
  actingUserId: string,
  secretId: string,
  targetUserId: string,
  permission: Permission,
  tenantId?: string | null
) {
  const access = await permissionService.canManageSecret(actingUserId, secretId, tenantId);
  if (!access.allowed) throw new AppError('Secret not found', 404);

  const secret = access.secret;

  // For team secrets, only TEAM_ADMIN can update share permissions
  if (secret.teamId && access.teamRole !== 'TEAM_ADMIN') {
    throw new AppError('Only team admins can update team secret shares', 403);
  }

  const shared = await prisma.sharedSecret.findFirst({
    where: { secretId, sharedWithUserId: targetUserId },
  });
  if (!shared) throw new AppError('Share not found', 404);

  const result = await prisma.sharedSecret.update({
    where: { id: shared.id },
    data: { permission },
  });

  // Notify target user
  const actor = await prisma.user.findUnique({
    where: { id: actingUserId },
    select: { username: true, email: true },
  });
  const actorName = actor?.username || actor?.email || 'Someone';
  const permLabel = permission === 'FULL_ACCESS' ? 'Full Access' : 'Read Only';
  const msg = `${actorName} changed your permission on secret "${secret.name}" to ${permLabel}`;

  createNotificationAsync({
    userId: targetUserId,
    type: 'SHARE_PERMISSION_UPDATED',
    message: msg,
    relatedId: secretId,
  });
  emitNotification(targetUserId, {
    id: '',
    type: 'SHARE_PERMISSION_UPDATED',
    message: msg,
    read: false,
    relatedId: secretId,
    createdAt: new Date(),
  });

  return result;
}

export async function listSecretShares(
  actingUserId: string,
  secretId: string,
  tenantId?: string | null
) {
  const access = await permissionService.canManageSecret(actingUserId, secretId, tenantId);
  if (!access.allowed) throw new AppError('Secret not found', 404);

  const secret = access.secret;

  // For team secrets, only TEAM_ADMIN can view shares
  if (secret.teamId && access.teamRole !== 'TEAM_ADMIN') {
    throw new AppError('Only team admins can view team secret shares', 403);
  }

  const shares = await prisma.sharedSecret.findMany({
    where: { secretId },
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
