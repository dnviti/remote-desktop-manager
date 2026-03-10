import prisma, { Prisma } from '../lib/prisma';
import { AppError } from '../middleware/error.middleware';
import {
  encrypt,
  decrypt,
  getMasterKey,
  generateTenantMasterKey,
  encryptTenantKey,
  decryptTenantKey,
  storeTenantVaultSession,
  getTenantMasterKey as getCachedTenantKey,
} from './crypto.service';
import { resolveTeamKey } from './team.service';
import * as permissionService from './permission.service';
import type { EncryptedField, SecretPayload } from '../types';

// --- Input / Output interfaces ---

export interface CreateSecretInput {
  name: string;
  description?: string;
  type: 'LOGIN' | 'SSH_KEY' | 'CERTIFICATE' | 'API_KEY' | 'SECURE_NOTE';
  scope: 'PERSONAL' | 'TEAM' | 'TENANT';
  teamId?: string;
  tenantId?: string;
  folderId?: string;
  data: SecretPayload;
  metadata?: Record<string, unknown>;
  tags?: string[];
  expiresAt?: Date;
}

export interface UpdateSecretInput {
  name?: string;
  description?: string | null;
  data?: SecretPayload;
  metadata?: Record<string, unknown> | null;
  tags?: string[];
  folderId?: string | null;
  isFavorite?: boolean;
  expiresAt?: Date | null;
  changeNote?: string;
}

export interface SecretListFilters {
  scope?: 'PERSONAL' | 'TEAM' | 'TENANT';
  type?: 'LOGIN' | 'SSH_KEY' | 'CERTIFICATE' | 'API_KEY' | 'SECURE_NOTE';
  teamId?: string;
  folderId?: string | null;
  search?: string;
  tags?: string[];
  isFavorite?: boolean;
}

// --- Encryption key resolution ---

export async function resolveTenantKey(tenantId: string, userId: string): Promise<Buffer> {
  // Try cache first
  const cached = getCachedTenantKey(tenantId, userId);
  if (cached) return cached;

  // Get user's personal master key
  const userMasterKey = getMasterKey(userId);
  if (!userMasterKey) {
    throw new AppError('Vault is locked. Please unlock it first.', 403);
  }

  // Load from DB and decrypt
  const membership = await prisma.tenantVaultMember.findUnique({
    where: { tenantId_userId: { tenantId, userId } },
  });
  if (
    !membership?.encryptedTenantVaultKey ||
    !membership?.tenantVaultKeyIV ||
    !membership?.tenantVaultKeyTag
  ) {
    throw new AppError('Tenant vault key not found. An admin must distribute the key to you.', 404);
  }

  const encField: EncryptedField = {
    ciphertext: membership.encryptedTenantVaultKey,
    iv: membership.tenantVaultKeyIV,
    tag: membership.tenantVaultKeyTag,
  };
  const tenantKey = decryptTenantKey(encField, userMasterKey);
  storeTenantVaultSession(tenantId, userId, tenantKey);

  return tenantKey;
}

export async function resolveSecretEncryptionKey(
  userId: string,
  scope: 'PERSONAL' | 'TEAM' | 'TENANT',
  teamId?: string | null,
  tenantId?: string | null
): Promise<Buffer> {
  switch (scope) {
    case 'PERSONAL': {
      const key = getMasterKey(userId);
      if (!key) throw new AppError('Vault is locked. Please unlock it first.', 403);
      return key;
    }
    case 'TEAM': {
      if (!teamId) throw new AppError('teamId is required for team-scoped secrets', 400);
      return resolveTeamKey(teamId, userId);
    }
    case 'TENANT': {
      if (!tenantId) throw new AppError('tenantId is required for tenant-scoped secrets', 400);
      return resolveTenantKey(tenantId, userId);
    }
  }
}

// --- Tenant vault initialization & key distribution ---

export async function initTenantVault(
  tenantId: string,
  initiatorUserId: string
): Promise<void> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new AppError('Tenant not found', 404);
  if (tenant.hasTenantVaultKey) {
    throw new AppError('Tenant vault is already initialized', 400);
  }

  const initiatorMasterKey = getMasterKey(initiatorUserId);
  if (!initiatorMasterKey) {
    throw new AppError('Vault is locked. Please unlock it first.', 403);
  }

  const tenantKey = generateTenantMasterKey();
  const encKeyForInitiator = encryptTenantKey(tenantKey, initiatorMasterKey);

  // Find all tenant members with unlocked vaults (besides initiator)
  const tenantMembers = await prisma.tenantMember.findMany({
    where: { tenantId, userId: { not: initiatorUserId } },
    select: { userId: true },
  });
  const tenantUsers = tenantMembers.map((m) => ({ id: m.userId }));

  await prisma.$transaction(async (tx) => {
    await tx.tenant.update({
      where: { id: tenantId },
      data: { hasTenantVaultKey: true },
    });

    await tx.tenantVaultMember.create({
      data: {
        tenantId,
        userId: initiatorUserId,
        encryptedTenantVaultKey: encKeyForInitiator.ciphertext,
        tenantVaultKeyIV: encKeyForInitiator.iv,
        tenantVaultKeyTag: encKeyForInitiator.tag,
      },
    });

    // Distribute to other users whose vaults are currently unlocked
    for (const user of tenantUsers) {
      const userMasterKey = getMasterKey(user.id);
      if (userMasterKey) {
        const encKey = encryptTenantKey(tenantKey, userMasterKey);
        await tx.tenantVaultMember.create({
          data: {
            tenantId,
            userId: user.id,
            encryptedTenantVaultKey: encKey.ciphertext,
            tenantVaultKeyIV: encKey.iv,
            tenantVaultKeyTag: encKey.tag,
          },
        });
      }
    }
  });

  // Cache for initiator
  storeTenantVaultSession(tenantId, initiatorUserId, tenantKey);
  tenantKey.fill(0);
}

export async function distributeTenantKeyToUser(
  tenantId: string,
  targetUserId: string,
  distributorUserId: string
): Promise<void> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant?.hasTenantVaultKey) {
    throw new AppError('Tenant vault is not initialized', 400);
  }

  const existing = await prisma.tenantVaultMember.findUnique({
    where: { tenantId_userId: { tenantId, userId: targetUserId } },
  });
  if (existing) {
    throw new AppError('User already has the tenant vault key', 400);
  }

  const targetMembership = await prisma.tenantMember.findUnique({
    where: { tenantId_userId: { tenantId, userId: targetUserId } },
  });
  if (!targetMembership) {
    throw new AppError('User is not a member of this tenant', 400);
  }

  // Distributor needs their vault unlocked + tenant key access
  const tenantKey = await resolveTenantKey(tenantId, distributorUserId);

  // Target user's vault must be unlocked
  const targetMasterKey = getMasterKey(targetUserId);
  if (!targetMasterKey) {
    throw new AppError("Target user's vault is locked. They must unlock their vault first.", 403);
  }

  const encKey = encryptTenantKey(tenantKey, targetMasterKey);

  await prisma.tenantVaultMember.create({
    data: {
      tenantId,
      userId: targetUserId,
      encryptedTenantVaultKey: encKey.ciphertext,
      tenantVaultKeyIV: encKey.iv,
      tenantVaultKeyTag: encKey.tag,
    },
  });
}

// --- Secret CRUD ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function secretSummary(secret: any) {
  return {
    id: secret.id,
    name: secret.name,
    description: secret.description,
    type: secret.type,
    scope: secret.scope,
    teamId: secret.teamId,
    tenantId: secret.tenantId,
    folderId: secret.folderId,
    metadata: secret.metadata,
    tags: secret.tags,
    isFavorite: secret.isFavorite,
    expiresAt: secret.expiresAt,
    currentVersion: secret.currentVersion,
    createdAt: secret.createdAt,
    updatedAt: secret.updatedAt,
  };
}

export async function createSecret(
  userId: string,
  input: CreateSecretInput,
  tenantId?: string | null
) {
  // Validate scope-specific requirements
  if (input.scope === 'TEAM' && !input.teamId) {
    throw new AppError('teamId is required for team-scoped secrets', 400);
  }
  if (input.scope === 'TENANT') {
    const effectiveTenantId = input.tenantId || tenantId;
    if (!effectiveTenantId) {
      throw new AppError('tenantId is required for tenant-scoped secrets', 400);
    }
    input.tenantId = effectiveTenantId;
  }

  // Permission checks
  if (input.scope === 'TEAM') {
    const perm = await permissionService.canManageTeamResource(
      userId,
      input.teamId as string,
      'TEAM_EDITOR',
      tenantId
    );
    if (!perm.allowed) throw new AppError('Insufficient team role to create secrets', 403);
  }
  if (input.scope === 'TENANT') {
    const effectiveTenantId = input.tenantId || tenantId;
    const membership = effectiveTenantId ? await prisma.tenantMember.findUnique({
      where: { tenantId_userId: { tenantId: effectiveTenantId, userId } },
      select: { role: true },
    }) : null;
    if (membership?.role !== 'OWNER' && membership?.role !== 'ADMIN') {
      throw new AppError('Only admins and owners can create tenant-scoped secrets', 403);
    }
  }

  // Validate type matches data
  if (input.data.type !== input.type) {
    throw new AppError('Secret data type does not match declared type', 400);
  }

  // Resolve encryption key for scope
  const encryptionKey = await resolveSecretEncryptionKey(
    userId,
    input.scope,
    input.teamId,
    input.tenantId || tenantId
  );

  // Encrypt the secret data as JSON
  const plaintext = JSON.stringify(input.data);
  const encrypted = encrypt(plaintext, encryptionKey);

  const secret = await prisma.$transaction(async (tx) => {
    const s = await tx.vaultSecret.create({
      data: {
        name: input.name,
        description: input.description || null,
        type: input.type,
        scope: input.scope,
        userId,
        teamId: input.scope === 'TEAM' ? (input.teamId as string) : null,
        tenantId:
          input.scope === 'TENANT'
            ? ((input.tenantId || tenantId) as string)
            : input.scope === 'TEAM'
              ? tenantId || null
              : null,
        folderId: input.folderId || null,
        encryptedData: encrypted.ciphertext,
        dataIV: encrypted.iv,
        dataTag: encrypted.tag,
        metadata: (input.metadata as Prisma.InputJsonValue) ?? undefined,
        tags: input.tags ?? [],
        expiresAt: input.expiresAt || null,
      },
    });

    // Create initial version record
    await tx.vaultSecretVersion.create({
      data: {
        secretId: s.id,
        version: 1,
        encryptedData: encrypted.ciphertext,
        dataIV: encrypted.iv,
        dataTag: encrypted.tag,
        changedBy: userId,
        changeNote: 'Initial version',
      },
    });

    return s;
  });

  return secretSummary(secret);
}

export async function getSecret(
  userId: string,
  secretId: string,
  tenantId?: string | null
) {
  const access = await permissionService.canViewSecret(userId, secretId, tenantId);
  if (!access.allowed) throw new AppError('Secret not found', 404);

  const secret = access.secret;

  // Shared secrets: decrypt from SharedSecret table with user's personal key
  if (access.accessType === 'shared') {
    const sharedRecord = await prisma.sharedSecret.findFirst({
      where: { secretId, sharedWithUserId: userId },
    });
    if (!sharedRecord) throw new AppError('Secret not found', 404);

    const personalKey = getMasterKey(userId);
    if (!personalKey) throw new AppError('Vault is locked. Please unlock it first.', 403);

    const decryptedJson = decrypt(
      { ciphertext: sharedRecord.encryptedData, iv: sharedRecord.dataIV, tag: sharedRecord.dataTag },
      personalKey
    );
    const data: SecretPayload = JSON.parse(decryptedJson);

    return {
      ...secretSummary(secret),
      data,
      shared: true,
      permission: sharedRecord.permission,
    };
  }

  const encryptionKey = await resolveSecretEncryptionKey(
    userId,
    secret.scope,
    secret.teamId,
    secret.tenantId
  );

  const decryptedJson = decrypt(
    { ciphertext: secret.encryptedData, iv: secret.dataIV, tag: secret.dataTag },
    encryptionKey
  );
  const data: SecretPayload = JSON.parse(decryptedJson);

  return {
    ...secretSummary(secret),
    data,
  };
}

export async function updateSecret(
  userId: string,
  secretId: string,
  input: UpdateSecretInput,
  tenantId?: string | null
) {
  const access = await permissionService.canManageSecret(userId, secretId, tenantId);
  if (!access.allowed) throw new AppError('Secret not found', 404);

  const secret = access.secret;
  const data: Record<string, unknown> = {};

  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.metadata !== undefined) data.metadata = input.metadata as Prisma.InputJsonValue;
  if (input.tags !== undefined) data.tags = input.tags;
  if (input.folderId !== undefined) data.folderId = input.folderId;
  if (input.isFavorite !== undefined) data.isFavorite = input.isFavorite;
  if (input.expiresAt !== undefined) data.expiresAt = input.expiresAt;

  // If data is being updated, re-encrypt and create new version
  if (input.data) {
    const encryptionKey = await resolveSecretEncryptionKey(
      userId,
      secret.scope,
      secret.teamId,
      secret.tenantId
    );

    const plaintext = JSON.stringify(input.data);
    const encrypted = encrypt(plaintext, encryptionKey);

    data.encryptedData = encrypted.ciphertext;
    data.dataIV = encrypted.iv;
    data.dataTag = encrypted.tag;
    data.currentVersion = secret.currentVersion + 1;

    const updated = await prisma.$transaction(async (tx) => {
      const s = await tx.vaultSecret.update({
        where: { id: secretId },
        data,
      });

      await tx.vaultSecretVersion.create({
        data: {
          secretId,
          version: s.currentVersion,
          encryptedData: encrypted.ciphertext,
          dataIV: encrypted.iv,
          dataTag: encrypted.tag,
          changedBy: userId,
          changeNote: input.changeNote || null,
        },
      });

      return s;
    });

    return secretSummary(updated);
  }

  // Metadata-only update (no versioning needed)
  if (Object.keys(data).length === 0) {
    throw new AppError('No fields to update', 400);
  }

  const updated = await prisma.vaultSecret.update({
    where: { id: secretId },
    data,
  });

  return secretSummary(updated);
}

export async function deleteSecret(
  userId: string,
  secretId: string,
  tenantId?: string | null
) {
  const access = await permissionService.canManageSecret(userId, secretId, tenantId);
  if (!access.allowed) throw new AppError('Secret not found', 404);

  // Cascade deletes versions via onDelete: Cascade
  await prisma.vaultSecret.delete({ where: { id: secretId } });
  return { deleted: true };
}

export async function listSecrets(
  userId: string,
  filters: SecretListFilters,
  tenantId?: string | null
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  if (filters.scope === 'PERSONAL') {
    where.userId = userId;
    where.scope = 'PERSONAL';
  } else if (filters.scope === 'TEAM') {
    if (filters.teamId) {
      where.teamId = filters.teamId;
      where.scope = 'TEAM';
    } else {
      const memberships = await prisma.teamMember.findMany({
        where: { userId },
        select: { teamId: true },
      });
      where.teamId = { in: memberships.map((m) => m.teamId) };
      where.scope = 'TEAM';
    }
  } else if (filters.scope === 'TENANT') {
    if (!tenantId) throw new AppError('Tenant context required', 400);
    where.tenantId = tenantId;
    where.scope = 'TENANT';
  } else {
    // All accessible secrets: personal + team + tenant + shared
    const memberships = await prisma.teamMember.findMany({
      where: { userId },
      select: { teamId: true },
    });
    const teamIds = memberships.map((m) => m.teamId);

    const sharedSecrets = await prisma.sharedSecret.findMany({
      where: { sharedWithUserId: userId },
      select: { secretId: true },
    });
    const sharedIds = sharedSecrets.map((s) => s.secretId);

    where.OR = [
      { userId, scope: 'PERSONAL' },
      ...(teamIds.length > 0 ? [{ teamId: { in: teamIds }, scope: 'TEAM' as const }] : []),
      ...(tenantId ? [{ tenantId, scope: 'TENANT' as const }] : []),
      ...(sharedIds.length > 0 ? [{ id: { in: sharedIds } }] : []),
    ];
  }

  if (filters.type) where.type = filters.type;
  if (filters.folderId !== undefined) where.folderId = filters.folderId;
  if (filters.isFavorite !== undefined) where.isFavorite = filters.isFavorite;
  if (filters.tags && filters.tags.length > 0) {
    where.tags = { hasSome: filters.tags };
  }
  if (filters.search) {
    where.name = { contains: filters.search, mode: 'insensitive' };
  }

  const secrets = await prisma.vaultSecret.findMany({
    where,
    select: {
      id: true,
      name: true,
      description: true,
      type: true,
      scope: true,
      teamId: true,
      tenantId: true,
      folderId: true,
      metadata: true,
      tags: true,
      isFavorite: true,
      expiresAt: true,
      currentVersion: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: [{ name: 'asc' }],
  });

  return secrets;
}

// --- Versioning ---

export async function listSecretVersions(
  userId: string,
  secretId: string,
  tenantId?: string | null
) {
  const access = await permissionService.canViewSecret(userId, secretId, tenantId);
  if (!access.allowed) throw new AppError('Secret not found', 404);

  const versions = await prisma.vaultSecretVersion.findMany({
    where: { secretId },
    select: {
      id: true,
      version: true,
      changedBy: true,
      changeNote: true,
      createdAt: true,
      changer: { select: { email: true, username: true } },
    },
    orderBy: { version: 'desc' },
  });

  return versions;
}

export async function getSecretVersionData(
  userId: string,
  secretId: string,
  targetVersion: number,
  tenantId?: string | null
) {
  const access = await permissionService.canViewSecret(userId, secretId, tenantId);
  if (!access.allowed) throw new AppError('Secret not found', 404);

  // Shared users cannot view version data (encrypted with scope key, not share key)
  if (access.accessType === 'shared') {
    throw new AppError('Version data is not available for shared secrets', 403);
  }

  const secret = access.secret;

  const version = await prisma.vaultSecretVersion.findUnique({
    where: { secretId_version: { secretId, version: targetVersion } },
  });
  if (!version) throw new AppError('Version not found', 404);

  const encryptionKey = await resolveSecretEncryptionKey(
    userId,
    secret.scope,
    secret.teamId,
    secret.tenantId
  );

  const decryptedJson = decrypt(
    { ciphertext: version.encryptedData, iv: version.dataIV, tag: version.dataTag },
    encryptionKey
  );
  const data: SecretPayload = JSON.parse(decryptedJson);

  return { data };
}

export async function restoreSecretVersion(
  userId: string,
  secretId: string,
  targetVersion: number,
  tenantId?: string | null
) {
  const access = await permissionService.canManageSecret(userId, secretId, tenantId);
  if (!access.allowed) throw new AppError('Secret not found', 404);

  const secret = access.secret;

  const version = await prisma.vaultSecretVersion.findUnique({
    where: { secretId_version: { secretId, version: targetVersion } },
  });
  if (!version) throw new AppError('Version not found', 404);

  const newVersion = secret.currentVersion + 1;

  const updated = await prisma.$transaction(async (tx) => {
    const s = await tx.vaultSecret.update({
      where: { id: secretId },
      data: {
        encryptedData: version.encryptedData,
        dataIV: version.dataIV,
        dataTag: version.dataTag,
        currentVersion: newVersion,
      },
    });

    await tx.vaultSecretVersion.create({
      data: {
        secretId,
        version: newVersion,
        encryptedData: version.encryptedData,
        dataIV: version.dataIV,
        dataTag: version.dataTag,
        changedBy: userId,
        changeNote: `Restored from version ${targetVersion}`,
      },
    });

    return s;
  });

  return {
    id: updated.id,
    name: updated.name,
    currentVersion: updated.currentVersion,
    updatedAt: updated.updatedAt,
  };
}
