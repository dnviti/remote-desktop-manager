import prisma from '../lib/prisma';
import { Prisma, TenantRole } from '../generated/prisma/client';
import bcrypt from 'bcrypt';
import { TenantRoleType } from '../types';
import { AppError } from '../middleware/error.middleware';
import * as sshKeyService from './sshkey.service';
import * as auditService from './audit.service';
import * as identityVerification from './identityVerification.service';
import { logger } from '../utils/logger';
import { createNotificationAsync } from './notification.service';
import { emitNotification } from '../socket/notification.handler';
import {
  generateSalt,
  generateMasterKey,
  deriveKeyFromPassword,
  encryptMasterKey,
  generateRecoveryKey,
  encryptMasterKeyWithRecovery,
  lockVault,
} from './crypto.service';

const BCRYPT_ROUNDS = 12;

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 50);
}

async function ensureUniqueSlug(baseSlug: string, excludeId?: string): Promise<string> {
  let slug = baseSlug;
  let suffix = 1;
   
  while (true) {
    const existing = await prisma.tenant.findUnique({ where: { slug } });
    if (!existing || (excludeId && existing.id === excludeId)) break;
    slug = `${baseSlug}-${suffix}`;
    suffix++;
  }
  return slug;
}

export async function createTenant(userId: string, name: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) throw new AppError('User not found', 404);

  const slug = await ensureUniqueSlug(generateSlug(name));

  const tenant = await prisma.$transaction(async (tx) => {
    const t = await tx.tenant.create({
      data: { name, slug },
    });
    // Deactivate any existing active membership
    await tx.tenantMember.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false },
    });
    // Create OWNER membership for the new tenant
    await tx.tenantMember.create({
      data: { tenantId: t.id, userId, role: 'OWNER', isActive: true },
    });
    return t;
  });

  // Auto-generate SSH key pair (best-effort — must not block tenant creation)
  try {
    const keyPair = await sshKeyService.generateKeyPair(tenant.id);
    auditService.log({
      userId,
      action: 'SSH_KEY_GENERATE',
      targetType: 'SshKeyPair',
      targetId: keyPair.id,
      details: { auto: true, trigger: 'tenant_creation' },
    });
  } catch (err) {
    logger.warn(`Auto SSH key generation failed for tenant ${tenant.id}:`, err);
  }

  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    userCount: 1,
    teamCount: 0,
    createdAt: tenant.createdAt,
    updatedAt: tenant.updatedAt,
  };
}

export async function getTenant(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      _count: { select: { members: true, teams: true } },
    },
  });
  if (!tenant) throw new AppError('Organization not found', 404);

  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    mfaRequired: tenant.mfaRequired,
    defaultSessionTimeoutSeconds: tenant.defaultSessionTimeoutSeconds,
    vaultAutoLockMaxMinutes: tenant.vaultAutoLockMaxMinutes,
    dlpDisableCopy: tenant.dlpDisableCopy,
    dlpDisablePaste: tenant.dlpDisablePaste,
    dlpDisableDownload: tenant.dlpDisableDownload,
    dlpDisableUpload: tenant.dlpDisableUpload,
    enforcedConnectionSettings: tenant.enforcedConnectionSettings,
    userCount: tenant._count.members,
    teamCount: tenant._count.teams,
    createdAt: tenant.createdAt,
    updatedAt: tenant.updatedAt,
  };
}

export async function updateTenant(tenantId: string, data: {
  name?: string;
  defaultSessionTimeoutSeconds?: number;
  mfaRequired?: boolean;
  vaultAutoLockMaxMinutes?: number | null;
  dlpDisableCopy?: boolean;
  dlpDisablePaste?: boolean;
  dlpDisableDownload?: boolean;
  dlpDisableUpload?: boolean;
  enforcedConnectionSettings?: Prisma.InputJsonValue | null;
}) {
  const updateData: Record<string, unknown> = {};

  if (data.name !== undefined) {
    updateData.name = data.name;
    updateData.slug = await ensureUniqueSlug(generateSlug(data.name), tenantId);
  }
  if (data.defaultSessionTimeoutSeconds !== undefined) {
    updateData.defaultSessionTimeoutSeconds = data.defaultSessionTimeoutSeconds;
  }
  if (data.mfaRequired !== undefined) {
    updateData.mfaRequired = data.mfaRequired;
  }
  if (data.vaultAutoLockMaxMinutes !== undefined) {
    updateData.vaultAutoLockMaxMinutes = data.vaultAutoLockMaxMinutes;
  }
  if (data.dlpDisableCopy !== undefined) {
    updateData.dlpDisableCopy = data.dlpDisableCopy;
  }
  if (data.dlpDisablePaste !== undefined) {
    updateData.dlpDisablePaste = data.dlpDisablePaste;
  }
  if (data.dlpDisableDownload !== undefined) {
    updateData.dlpDisableDownload = data.dlpDisableDownload;
  }
  if (data.dlpDisableUpload !== undefined) {
    updateData.dlpDisableUpload = data.dlpDisableUpload;
  }
  if (data.enforcedConnectionSettings !== undefined) {
    updateData.enforcedConnectionSettings = data.enforcedConnectionSettings === null
      ? Prisma.JsonNull
      : data.enforcedConnectionSettings;
  }

  if (Object.keys(updateData).length === 0) {
    throw new AppError('No fields to update', 400);
  }

  const tenant = await prisma.tenant.update({
    where: { id: tenantId },
    data: updateData,
  });

  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    mfaRequired: tenant.mfaRequired,
    defaultSessionTimeoutSeconds: tenant.defaultSessionTimeoutSeconds,
    vaultAutoLockMaxMinutes: tenant.vaultAutoLockMaxMinutes,
    dlpDisableCopy: tenant.dlpDisableCopy,
    dlpDisablePaste: tenant.dlpDisablePaste,
    dlpDisableDownload: tenant.dlpDisableDownload,
    dlpDisableUpload: tenant.dlpDisableUpload,
    enforcedConnectionSettings: tenant.enforcedConnectionSettings,
    updatedAt: tenant.updatedAt,
  };
}

export async function deleteTenant(tenantId: string) {
  await prisma.$transaction(async (tx) => {
    // Delete all team members in this tenant's teams
    await tx.teamMember.deleteMany({
      where: { team: { tenantId } },
    });
    // Nullify teamId on connections belonging to this tenant's teams
    await tx.connection.updateMany({
      where: { team: { tenantId } },
      data: { teamId: null },
    });
    // Nullify teamId on folders belonging to this tenant's teams
    await tx.folder.updateMany({
      where: { team: { tenantId } },
      data: { teamId: null },
    });
    // Delete all teams
    await tx.team.deleteMany({
      where: { tenantId },
    });
    // TenantMember records are cascade-deleted with the tenant
    // Delete the tenant
    await tx.tenant.delete({ where: { id: tenantId } });
  });

  return { deleted: true };
}

export async function getTenantMfaStats(tenantId: string) {
  const members = await prisma.tenantMember.findMany({
    where: { tenantId },
    include: { user: { select: { totpEnabled: true, smsMfaEnabled: true } } },
  });

  const total = members.length;
  const withoutMfa = members.filter((m) => !m.user.totpEnabled && !m.user.smsMfaEnabled).length;

  return { total, withoutMfa };
}

export async function listTenantUsers(tenantId: string) {
  const members = await prisma.tenantMember.findMany({
    where: { tenantId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          username: true,
          avatarData: true,
          totpEnabled: true,
          smsMfaEnabled: true,
          enabled: true,
          createdAt: true,
        },
      },
    },
  });

  // Sort by role hierarchy: OWNER first, then descending privilege
  const roleOrder: Record<string, number> = { OWNER: 0, ADMIN: 1, OPERATOR: 2, MEMBER: 3, CONSULTANT: 4, AUDITOR: 5, GUEST: 6 };
  return members
    .map((m) => ({
      id: m.user.id,
      email: m.user.email,
      username: m.user.username,
      avatarData: m.user.avatarData,
      role: m.role,
      totpEnabled: m.user.totpEnabled,
      smsMfaEnabled: m.user.smsMfaEnabled,
      enabled: m.user.enabled,
      createdAt: m.user.createdAt,
      expiresAt: m.expiresAt?.toISOString() ?? null,
      expired: m.expiresAt ? m.expiresAt <= new Date() : false,
    }))
    .sort((a, b) => {
      const aOrder = roleOrder[a.role] ?? 3;
      const bOrder = roleOrder[b.role] ?? 3;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return (a.email ?? '').localeCompare(b.email ?? '');
    });
}

export async function getUserProfile(
  tenantId: string,
  targetUserId: string,
  viewerRole?: string,
) {
  const membership = await prisma.tenantMember.findUnique({
    where: { tenantId_userId: { tenantId, userId: targetUserId } },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          avatarData: true,
          createdAt: true,
          updatedAt: true,
          email: true,
          totpEnabled: true,
          smsMfaEnabled: true,
          webauthnEnabled: true,
          teamMembers: {
            include: {
              team: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });

  if (!membership) {
    throw new AppError('User not found in this organization', 404);
  }

  const isAdmin = viewerRole === 'OWNER' || viewerRole === 'ADMIN';

  // Public fields — always returned
  const profile: Record<string, unknown> = {
    id: membership.user.id,
    username: membership.user.username,
    avatarData: membership.user.avatarData,
    role: membership.role,
    joinedAt: membership.joinedAt,
    teams: membership.user.teamMembers.map((tm) => ({
      id: tm.team.id,
      name: tm.team.name,
      role: tm.role,
    })),
  };

  // Admin-only fields
  if (isAdmin) {
    profile.email = membership.user.email;
    profile.totpEnabled = membership.user.totpEnabled;
    profile.smsMfaEnabled = membership.user.smsMfaEnabled;
    profile.webauthnEnabled = membership.user.webauthnEnabled;
    profile.updatedAt = membership.user.updatedAt;

    const lastLog = await prisma.auditLog.findFirst({
      where: { userId: targetUserId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    profile.lastActivity = lastLog?.createdAt ?? null;
  }

  return profile;
}

export async function inviteUser(tenantId: string, email: string, role: TenantRoleType, expiresAt?: Date) {
  const targetUser = await prisma.user.findUnique({ where: { email } });
  if (!targetUser) {
    throw new AppError('User not found. They must register first.', 404);
  }

  const existingMembership = await prisma.tenantMember.findUnique({
    where: { tenantId_userId: { tenantId, userId: targetUser.id } },
  });
  if (existingMembership) {
    throw new AppError('User is already a member of this organization', 400);
  }

  const [membership, tenant] = await Promise.all([
    prisma.tenantMember.create({
      data: { tenantId, userId: targetUser.id, role: role as TenantRole, isActive: false, ...(expiresAt && { expiresAt }) },
    }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
  ]);

  const tenantName = tenant?.name ?? 'an organization';
  const roleLabels: Record<string, string> = {
    ADMIN: 'Admin', OPERATOR: 'Operator', MEMBER: 'Member',
    CONSULTANT: 'Consultant', AUDITOR: 'Auditor', GUEST: 'Guest',
  };
  const roleLabel = roleLabels[role] ?? role;
  const msg = `You've been invited to join "${tenantName}" as ${roleLabel}`;

  createNotificationAsync({
    userId: targetUser.id,
    type: 'TENANT_INVITATION',
    message: msg,
    relatedId: tenantId,
  });

  emitNotification(targetUser.id, {
    id: membership.id,
    type: 'TENANT_INVITATION',
    message: msg,
    read: false,
    relatedId: tenantId,
    createdAt: new Date(),
  });

  return {
    userId: targetUser.id,
    email: targetUser.email,
    username: targetUser.username,
    role,
  };
}

export async function updateUserRole(
  tenantId: string,
  targetUserId: string,
  newRole: TenantRoleType,
  actingUserId: string
) {
  const membership = await prisma.tenantMember.findUnique({
    where: { tenantId_userId: { tenantId, userId: targetUserId } },
  });
  if (!membership) throw new AppError('User not found in this organization', 404);

  // Prevent demoting the last OWNER
  if (membership.role === 'OWNER' && newRole !== 'OWNER') {
    const ownerCount = await prisma.tenantMember.count({
      where: { tenantId, role: 'OWNER' },
    });
    if (ownerCount <= 1) {
      throw new AppError('Cannot change role of the last owner. Transfer ownership first.', 400);
    }
  }

  // Prevent self-demotion if last OWNER
  if (targetUserId === actingUserId && membership.role === 'OWNER' && newRole !== 'OWNER') {
    const ownerCount = await prisma.tenantMember.count({
      where: { tenantId, role: 'OWNER' },
    });
    if (ownerCount <= 1) {
      throw new AppError('Cannot demote yourself as the last owner', 400);
    }
  }

  const updated = await prisma.tenantMember.update({
    where: { tenantId_userId: { tenantId, userId: targetUserId } },
    data: { role: newRole as TenantRole },
    include: { user: { select: { id: true, email: true, username: true } } },
  });

  return { id: updated.user.id, email: updated.user.email, username: updated.user.username, role: updated.role };
}

export async function removeUser(tenantId: string, targetUserId: string, actingUserId: string) {
  const membership = await prisma.tenantMember.findUnique({
    where: { tenantId_userId: { tenantId, userId: targetUserId } },
  });
  if (!membership) throw new AppError('User not found in this organization', 404);

  // Prevent removing the last OWNER
  if (membership.role === 'OWNER') {
    const ownerCount = await prisma.tenantMember.count({
      where: { tenantId, role: 'OWNER' },
    });
    if (ownerCount <= 1) {
      throw new AppError('Cannot remove the last owner', 400);
    }
  }

  // Prevent self-removal (use "leave organization" flow instead, if needed)
  if (targetUserId === actingUserId) {
    throw new AppError('Cannot remove yourself. Use leave organization instead.', 400);
  }

  await prisma.$transaction(async (tx) => {
    // Remove from all teams in this tenant
    await tx.teamMember.deleteMany({
      where: {
        userId: targetUserId,
        team: { tenantId },
      },
    });
    // Remove tenant membership
    await tx.tenantMember.delete({
      where: { tenantId_userId: { tenantId, userId: targetUserId } },
    });
  });

  return { removed: true };
}

export async function createUser(
  tenantId: string,
  data: { email: string; username?: string; password: string; role: TenantRoleType; expiresAt?: string },
  _actingUserId: string,
) {
  // Check for existing user
  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) {
    const existingMembership = await prisma.tenantMember.findUnique({
      where: { tenantId_userId: { tenantId, userId: existing.id } },
    });
    if (existingMembership) {
      throw new AppError('User is already a member of this organization', 400);
    }
    throw new AppError('A user with this email already exists', 409);
  }

  // Hash password
  const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);

  // Vault encryption setup (identical to auth.service register flow)
  const vaultSalt = generateSalt();
  const masterKey = generateMasterKey();
  const derivedKey = await deriveKeyFromPassword(data.password, vaultSalt);
  const encryptedVault = encryptMasterKey(masterKey, derivedKey);

  // Recovery key
  const recoveryKey = generateRecoveryKey();
  const recoveryResult = await encryptMasterKeyWithRecovery(masterKey, recoveryKey);

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: data.email,
        username: data.username || null,
        passwordHash,
        vaultSalt,
        encryptedVaultKey: encryptedVault.ciphertext,
        vaultKeyIV: encryptedVault.iv,
        vaultKeyTag: encryptedVault.tag,
        encryptedVaultRecoveryKey: recoveryResult.encrypted.ciphertext,
        vaultRecoveryKeyIV: recoveryResult.encrypted.iv,
        vaultRecoveryKeyTag: recoveryResult.encrypted.tag,
        vaultRecoveryKeySalt: recoveryResult.salt,
        emailVerified: true,
      },
      select: {
        id: true,
        email: true,
        username: true,
        createdAt: true,
      },
    });

    const membership = await tx.tenantMember.create({
      data: { tenantId, userId: user.id, role: data.role as TenantRole, isActive: false, ...(data.expiresAt && { expiresAt: new Date(data.expiresAt) }) },
    });

    return { ...user, role: membership.role };
  });

  // Zero sensitive data
  masterKey.fill(0);
  derivedKey.fill(0);

  return { user: result, recoveryKey };
}

export async function toggleUserEnabled(
  tenantId: string,
  targetUserId: string,
  enabled: boolean,
  actingUserId: string,
) {
  const membership = await prisma.tenantMember.findUnique({
    where: { tenantId_userId: { tenantId, userId: targetUserId } },
  });
  if (!membership) {
    throw new AppError('User not found in this organization', 404);
  }

  if (targetUserId === actingUserId) {
    throw new AppError('Cannot disable your own account', 400);
  }

  if (!enabled && membership.role === 'OWNER') {
    // Count enabled owners by joining TenantMember with User
    const enabledOwners = await prisma.tenantMember.count({
      where: { tenantId, role: 'OWNER', user: { enabled: true } },
    });
    if (enabledOwners <= 1) {
      throw new AppError('Cannot disable the last active owner', 400);
    }
  }

  const updated = await prisma.user.update({
    where: { id: targetUserId },
    data: { enabled },
    select: {
      id: true,
      email: true,
      username: true,
      enabled: true,
    },
  });

  // If disabling, revoke all refresh tokens to force immediate logout
  if (!enabled) {
    await prisma.refreshToken.deleteMany({
      where: { userId: targetUserId },
    });
  }

  return { ...updated, role: membership.role };
}

export async function updateMembershipExpiry(
  tenantId: string,
  targetUserId: string,
  expiresAt: Date | null,
) {
  const membership = await prisma.tenantMember.findUnique({
    where: { tenantId_userId: { tenantId, userId: targetUserId } },
  });
  if (!membership) {
    throw new AppError('User not found in this organization', 404);
  }
  if (membership.role === 'OWNER') {
    throw new AppError('Cannot set expiration on owner membership', 400);
  }
  return prisma.tenantMember.update({
    where: { tenantId_userId: { tenantId, userId: targetUserId } },
    data: { expiresAt },
  });
}

// ---------------------------------------------------------------------------
// Admin operations on other users (requires identity verification)
// ---------------------------------------------------------------------------

export async function adminChangeUserEmail(
  tenantId: string,
  actingUserId: string,
  targetUserId: string,
  newEmail: string,
  verificationId: string,
) {
  identityVerification.consumeVerification(verificationId, actingUserId, 'admin-action');

  const actingMembership = await prisma.tenantMember.findUnique({
    where: { tenantId_userId: { tenantId, userId: actingUserId } },
  });
  if (!actingMembership || (actingMembership.role !== 'ADMIN' && actingMembership.role !== 'OWNER')) {
    throw new AppError('Insufficient permissions', 403);
  }

  const targetMembership = await prisma.tenantMember.findUnique({
    where: { tenantId_userId: { tenantId, userId: targetUserId } },
    include: { user: { select: { email: true } } },
  });
  if (!targetMembership) throw new AppError('User not found in this organization', 404);

  const oldEmail = targetMembership.user.email;

  const existing = await prisma.user.findUnique({ where: { email: newEmail } });
  if (existing && existing.id !== targetUserId) {
    throw new AppError('Email already in use', 409);
  }

  const updated = await prisma.user.update({
    where: { id: targetUserId },
    data: { email: newEmail, emailVerified: false },
    select: { id: true, email: true, username: true },
  });

  auditService.log({
    userId: actingUserId,
    action: 'ADMIN_EMAIL_CHANGE',
    targetType: 'User',
    targetId: targetUserId,
    details: { newEmail, oldEmail },
  });

  return updated;
}

/**
 * Core password-reset logic: hashes new password, regenerates vault,
 * wipes encrypted data, invalidates tokens, and locks vault.
 * Used by both the web admin flow and the CLI.
 */
async function resetPasswordCore(targetUserId: string, newPassword: string) {
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  // Generate fresh vault
  const newMasterKey = generateMasterKey();
  const newVaultSalt = generateSalt();
  const newDerivedKey = await deriveKeyFromPassword(newPassword, newVaultSalt);
  const newEncryptedVault = encryptMasterKey(newMasterKey, newDerivedKey);

  // Generate recovery key
  const recoveryKey = generateRecoveryKey();
  const recoveryResult = await encryptMasterKeyWithRecovery(newMasterKey, recoveryKey);

  newMasterKey.fill(0);
  newDerivedKey.fill(0);

  // Wipe all encrypted data and update vault in a transaction
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: targetUserId },
      data: {
        passwordHash,
        vaultSalt: newVaultSalt,
        encryptedVaultKey: newEncryptedVault.ciphertext,
        vaultKeyIV: newEncryptedVault.iv,
        vaultKeyTag: newEncryptedVault.tag,
        encryptedVaultRecoveryKey: recoveryResult.encrypted.ciphertext,
        vaultRecoveryKeyIV: recoveryResult.encrypted.iv,
        vaultRecoveryKeyTag: recoveryResult.encrypted.tag,
        vaultRecoveryKeySalt: recoveryResult.salt,
        // Disable TOTP (encrypted secret is lost with old vault key)
        totpEnabled: false,
        totpSecret: null,
        encryptedTotpSecret: null,
        totpSecretIV: null,
        totpSecretTag: null,
      },
    });

    // Wipe encrypted connection credentials
    await tx.connection.updateMany({
      where: { userId: targetUserId },
      data: {
        encryptedUsername: null,
        usernameIV: null,
        usernameTag: null,
        encryptedPassword: null,
        passwordIV: null,
        passwordTag: null,
      },
    });

    // Wipe shared connections
    await tx.sharedConnection.deleteMany({
      where: { sharedByUserId: targetUserId },
    });

    // Wipe team vault keys
    await tx.teamMember.updateMany({
      where: { userId: targetUserId },
      data: {
        encryptedTeamVaultKey: null,
        teamVaultKeyIV: null,
        teamVaultKeyTag: null,
      },
    });

    // Wipe tenant vault memberships
    await tx.tenantVaultMember.deleteMany({
      where: { userId: targetUserId },
    });

    // Wipe vault secrets
    await tx.vaultSecret.deleteMany({
      where: { userId: targetUserId },
    });

    // Wipe shared secrets
    await tx.sharedSecret.deleteMany({
      where: { sharedByUserId: targetUserId },
    });

    // Wipe external secret shares
    await tx.externalSecretShare.deleteMany({
      where: { secret: { userId: targetUserId } },
    });
  });

  // Invalidate all refresh tokens (force re-login)
  await prisma.refreshToken.deleteMany({
    where: { userId: targetUserId },
  });

  // Lock vault in memory
  lockVault(targetUserId);

  return { recoveryKey };
}

export async function adminChangeUserPassword(
  tenantId: string,
  actingUserId: string,
  targetUserId: string,
  newPassword: string,
  verificationId: string,
) {
  identityVerification.consumeVerification(verificationId, actingUserId, 'admin-action');

  const actingMembership = await prisma.tenantMember.findUnique({
    where: { tenantId_userId: { tenantId, userId: actingUserId } },
  });
  if (!actingMembership || (actingMembership.role !== 'ADMIN' && actingMembership.role !== 'OWNER')) {
    throw new AppError('Insufficient permissions', 403);
  }

  const targetMembership = await prisma.tenantMember.findUnique({
    where: { tenantId_userId: { tenantId, userId: targetUserId } },
  });
  if (!targetMembership) throw new AppError('User not found in this organization', 404);

  const result = await resetPasswordCore(targetUserId, newPassword);

  auditService.log({
    userId: actingUserId,
    action: 'ADMIN_PASSWORD_CHANGE',
    targetType: 'User',
    targetId: targetUserId,
    details: { vaultReset: true },
  });

  logger.verbose(`Admin ${actingUserId} reset password for user ${targetUserId}`);

  return result;
}

/**
 * Direct password reset for CLI usage — bypasses identity verification
 * and permission checks (CLI access implies full trust).
 */
export async function adminResetPasswordDirect(
  tenantId: string,
  targetUserId: string,
  newPassword: string,
) {
  const targetMembership = await prisma.tenantMember.findUnique({
    where: { tenantId_userId: { tenantId, userId: targetUserId } },
  });
  if (!targetMembership) throw new AppError('User not found in this organization', 404);

  const result = await resetPasswordCore(targetUserId, newPassword);

  logger.verbose(`CLI reset password for user ${targetUserId}`);

  return result;
}

export async function listUserTenants(userId: string) {
  const memberships = await prisma.tenantMember.findMany({
    where: { userId },
    include: {
      tenant: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { joinedAt: 'asc' },
  });

  return memberships.map((m) => ({
    tenantId: m.tenant.id,
    name: m.tenant.name,
    slug: m.tenant.slug,
    role: m.role,
    isActive: m.isActive,
    joinedAt: m.joinedAt,
  }));
}

export async function getIpAllowlist(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { ipAllowlistEnabled: true, ipAllowlistMode: true, ipAllowlistEntries: true },
  });
  if (!tenant) throw new AppError('Organization not found', 404);
  return {
    enabled: tenant.ipAllowlistEnabled ?? false,
    mode: (tenant.ipAllowlistMode ?? 'flag') as 'flag' | 'block',
    entries: tenant.ipAllowlistEntries ?? [],
  };
}

export async function updateIpAllowlist(
  tenantId: string,
  payload: { enabled: boolean; mode: 'flag' | 'block'; entries: string[] },
) {
  const tenant = await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      ipAllowlistEnabled: payload.enabled,
      ipAllowlistMode: payload.mode,
      ipAllowlistEntries: payload.entries,
    },
    select: { ipAllowlistEnabled: true, ipAllowlistMode: true, ipAllowlistEntries: true },
  });
  return {
    enabled: tenant.ipAllowlistEnabled ?? false,
    mode: (tenant.ipAllowlistMode ?? 'flag') as 'flag' | 'block',
    entries: tenant.ipAllowlistEntries ?? [],
  };
}
