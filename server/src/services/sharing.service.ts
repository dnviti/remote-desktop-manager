import prisma, { Permission } from '../lib/prisma';
import { encrypt, decrypt, getMasterKey } from './crypto.service';
import { AppError } from '../middleware/error.middleware';
import { createNotificationAsync } from './notification.service';
import { emitNotification } from '../socket/notification.handler';
import { resolveTeamKey } from './team.service';
import * as permissionService from './permission.service';

export async function shareConnection(
  actingUserId: string,
  connectionId: string,
  target: { email?: string; userId?: string },
  permission: Permission,
  tenantId?: string | null
) {
  const access = await permissionService.canManageConnection(actingUserId, connectionId, tenantId);
  if (!access.allowed) throw new AppError('Connection not found', 404);

  const connection = access.connection;

  // For team connections, only TEAM_ADMIN can share
  if (connection.teamId && access.teamRole !== 'TEAM_ADMIN') {
    throw new AppError('Only team admins can share team connections', 403);
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

  // Tenant boundary check (bidirectional)
  const actingUser = await prisma.user.findUnique({
    where: { id: actingUserId },
    select: { tenantId: true },
  });
  const actingTenantId = actingUser?.tenantId ?? null;
  const targetTenantId = targetUser.tenantId ?? null;
  if (actingTenantId || targetTenantId) {
    if (actingTenantId !== targetTenantId) {
      throw new AppError('Cannot share with users outside your organization', 400);
    }
  }

  // Get target user's master key (they must have their vault unlocked)
  const targetKey = getMasterKey(targetUser.id);
  if (!targetKey) {
    throw new AppError(
      'Target user vault is locked. They must be logged in to receive shares.',
      400
    );
  }

  // Vault-backed connections: credentials resolved at session time from the vault secret.
  // No inline credential re-encryption needed — the shared user must have access to the vault secret.
  if (connection.credentialSecretId) {
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
        sharedByUserId: actingUserId,
        permission,
      },
      update: { permission },
    });

    // Notify target user
    const actor = await prisma.user.findUnique({
      where: { id: actingUserId },
      select: { username: true, email: true },
    });
    const actorName = actor?.username || actor?.email || 'Someone';
    const msg = `${actorName} shared "${connection.name}" with you (${permission === 'FULL_ACCESS' ? 'Full Access' : 'Read Only'})`;

    createNotificationAsync({
      userId: targetUser.id,
      type: 'CONNECTION_SHARED',
      message: msg,
      relatedId: connectionId,
    });

    emitNotification(targetUser.id, {
      id: shared.id,
      type: 'CONNECTION_SHARED',
      message: msg,
      read: false,
      relatedId: connectionId,
      createdAt: new Date(),
    });

    return { id: shared.id, permission: shared.permission, sharedWith: targetUser.email };
  }

  // Inline credentials: decrypt and re-encrypt for target user
  if (!connection.encryptedUsername || !connection.usernameIV || !connection.usernameTag ||
      !connection.encryptedPassword || !connection.passwordIV || !connection.passwordTag) {
    throw new AppError('Connection has no credentials to share', 400);
  }

  let decryptionKey: Buffer;
  if (connection.teamId) {
    decryptionKey = await resolveTeamKey(connection.teamId, actingUserId);
  } else {
    const ownerKey = getMasterKey(actingUserId);
    if (!ownerKey) throw new AppError('Vault is locked', 403);
    decryptionKey = ownerKey;
  }

  // Decrypt credentials with source key
  const username = decrypt(
    {
      ciphertext: connection.encryptedUsername,
      iv: connection.usernameIV,
      tag: connection.usernameTag,
    },
    decryptionKey
  );
  const password = decrypt(
    {
      ciphertext: connection.encryptedPassword,
      iv: connection.passwordIV,
      tag: connection.passwordTag,
    },
    decryptionKey
  );

  // Re-encrypt with target user's personal key
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
      sharedByUserId: actingUserId,
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
  const actor = await prisma.user.findUnique({
    where: { id: actingUserId },
    select: { username: true, email: true },
  });
  const actorName = actor?.username || actor?.email || 'Someone';
  const msg = `${actorName} shared "${connection.name}" with you (${permission === 'FULL_ACCESS' ? 'Full Access' : 'Read Only'})`;

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
    sharedWith: targetUser.email,
  };
}

export interface BatchShareResult {
  shared: number;
  failed: number;
  alreadyShared: number;
  errors: Array<{ connectionId: string; reason: string }>;
}

export async function batchShareConnections(
  actingUserId: string,
  connectionIds: string[],
  target: { email?: string; userId?: string },
  permission: Permission,
  tenantId?: string | null,
  folderName?: string
): Promise<BatchShareResult> {
  // Resolve target user once
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

  const results = await Promise.allSettled(
    connectionIds.map((connectionId) =>
      shareConnection(actingUserId, connectionId, { userId: targetUser!.id }, permission, tenantId)
    )
  );

  let shared = 0;
  let failed = 0;
  let alreadyShared = 0;
  const errors: Array<{ connectionId: string; reason: string }> = [];

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      shared++;
    } else {
      const reason = result.reason instanceof AppError ? result.reason.message : 'Unknown error';
      if (reason.includes('already')) {
        alreadyShared++;
      } else {
        failed++;
        errors.push({ connectionId: connectionIds[index], reason });
      }
    }
  });

  // Send a single summary notification
  if (shared > 0) {
    const actor = await prisma.user.findUnique({
      where: { id: actingUserId },
      select: { username: true, email: true },
    });
    const actorName = actor?.username || actor?.email || 'Someone';
    const permLabel = permission === 'FULL_ACCESS' ? 'Full Access' : 'Read Only';
    const folderPart = folderName ? ` from folder "${folderName}"` : '';
    const msg = `${actorName} shared ${shared} connection${shared > 1 ? 's' : ''}${folderPart} with you (${permLabel})`;

    createNotificationAsync({
      userId: targetUser.id,
      type: 'CONNECTION_SHARED',
      message: msg,
    });
    emitNotification(targetUser.id, {
      id: '',
      type: 'CONNECTION_SHARED',
      message: msg,
      read: false,
      relatedId: connectionIds[0],
      createdAt: new Date(),
    });
  }

  return { shared, failed, alreadyShared, errors };
}

export async function unshareConnection(
  actingUserId: string,
  connectionId: string,
  targetUserId: string,
  tenantId?: string | null
) {
  const access = await permissionService.canManageConnection(actingUserId, connectionId, tenantId);
  if (!access.allowed) throw new AppError('Connection not found', 404);

  const connection = access.connection;

  // For team connections, only TEAM_ADMIN can revoke shares
  if (connection.teamId && access.teamRole !== 'TEAM_ADMIN') {
    throw new AppError('Only team admins can revoke team connection shares', 403);
  }

  await prisma.sharedConnection.deleteMany({
    where: { connectionId, sharedWithUserId: targetUserId },
  });

  // Notify target user
  const actor = await prisma.user.findUnique({
    where: { id: actingUserId },
    select: { username: true, email: true },
  });
  const actorName = actor?.username || actor?.email || 'Someone';
  const msg = `${actorName} revoked your access to "${connection.name}"`;

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
  actingUserId: string,
  connectionId: string,
  targetUserId: string,
  permission: Permission,
  tenantId?: string | null
) {
  const access = await permissionService.canManageConnection(actingUserId, connectionId, tenantId);
  if (!access.allowed) throw new AppError('Connection not found', 404);

  const connection = access.connection;

  // For team connections, only TEAM_ADMIN can update share permissions
  if (connection.teamId && access.teamRole !== 'TEAM_ADMIN') {
    throw new AppError('Only team admins can update team connection shares', 403);
  }

  const shared = await prisma.sharedConnection.findFirst({
    where: { connectionId, sharedWithUserId: targetUserId },
  });
  if (!shared) throw new AppError('Share not found', 404);

  const result = await prisma.sharedConnection.update({
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
  const msg = `${actorName} changed your permission on "${connection.name}" to ${permLabel}`;

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

export async function listShares(actingUserId: string, connectionId: string, tenantId?: string | null) {
  const access = await permissionService.canManageConnection(actingUserId, connectionId, tenantId);
  if (!access.allowed) throw new AppError('Connection not found', 404);

  const connection = access.connection;

  // For team connections, only TEAM_ADMIN can view shares
  if (connection.teamId && access.teamRole !== 'TEAM_ADMIN') {
    throw new AppError('Only team admins can view team connection shares', 403);
  }

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
