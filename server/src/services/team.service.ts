import prisma from '../lib/prisma';
import { AppError } from '../middleware/error.middleware';
import {
  generateTeamMasterKey,
  encryptTeamKey,
  decryptTeamKey,
  getMasterKey,
  storeTeamVaultSession,
  getTeamMasterKey as getCachedTeamKey,
  lockTeamVault,
} from './crypto.service';
import type { EncryptedField } from '../types';

const ROLE_HIERARCHY: Record<string, number> = {
  TEAM_VIEWER: 0,
  TEAM_EDITOR: 1,
  TEAM_ADMIN: 2,
};

export async function createTeam(
  tenantId: string,
  creatorUserId: string,
  name: string,
  description?: string
) {
  // Require creator's vault to be unlocked
  const userMasterKey = getMasterKey(creatorUserId);
  if (!userMasterKey) {
    throw new AppError('Vault is locked. Please unlock it first.', 403);
  }

  // Generate and encrypt the team master key
  const teamKey = generateTeamMasterKey();
  const encKey = encryptTeamKey(teamKey, userMasterKey);

  const team = await prisma.$transaction(async (tx) => {
    const t = await tx.team.create({
      data: { name, description: description ?? null, tenantId },
    });

    await tx.teamMember.create({
      data: {
        teamId: t.id,
        userId: creatorUserId,
        role: 'TEAM_ADMIN',
        encryptedTeamVaultKey: encKey.ciphertext,
        teamVaultKeyIV: encKey.iv,
        teamVaultKeyTag: encKey.tag,
      },
    });

    return t;
  });

  // Cache team key for creator
  storeTeamVaultSession(team.id, creatorUserId, teamKey);
  teamKey.fill(0);

  return {
    id: team.id,
    name: team.name,
    description: team.description,
    createdAt: team.createdAt,
  };
}

export async function listUserTeams(userId: string, tenantId: string) {
  const teams = await prisma.team.findMany({
    where: {
      tenantId,
      members: { some: { userId } },
    },
    include: {
      _count: { select: { members: true } },
      members: { where: { userId }, select: { role: true } },
    },
    orderBy: { name: 'asc' },
  });

  return teams.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    memberCount: t._count.members,
    myRole: t.members[0].role,
    createdAt: t.createdAt,
  }));
}

export async function getTeam(teamId: string, userId: string) {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: { _count: { select: { members: true } } },
  });
  if (!team) throw new AppError('Team not found', 404);

  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
  });
  if (!membership) throw new AppError('Team not found', 404);

  return {
    id: team.id,
    name: team.name,
    description: team.description,
    memberCount: team._count.members,
    myRole: membership.role,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
  };
}

export async function updateTeam(
  teamId: string,
  data: { name?: string; description?: string | null }
) {
  const updateData: Record<string, unknown> = {};

  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;

  if (Object.keys(updateData).length === 0) {
    throw new AppError('No fields to update', 400);
  }

  const team = await prisma.team.update({
    where: { id: teamId },
    data: updateData,
  });

  return {
    id: team.id,
    name: team.name,
    description: team.description,
    updatedAt: team.updatedAt,
  };
}

export async function deleteTeam(teamId: string) {
  await prisma.$transaction(async (tx) => {
    // Nullify teamId on connections belonging to this team
    await tx.connection.updateMany({
      where: { teamId },
      data: { teamId: null },
    });
    // Nullify teamId on folders belonging to this team
    await tx.folder.updateMany({
      where: { teamId },
      data: { teamId: null },
    });
    // Delete team (cascades to TeamMember via onDelete: Cascade)
    await tx.team.delete({ where: { id: teamId } });
  });

  // Clear all in-memory team vault sessions
  lockTeamVault(teamId);

  return { deleted: true };
}

export async function listMembers(teamId: string) {
  const members = await prisma.teamMember.findMany({
    where: { teamId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          username: true,
          avatarData: true,
        },
      },
    },
    orderBy: { joinedAt: 'asc' },
  });

  // Sort by role hierarchy: TEAM_ADMIN first, then TEAM_EDITOR, then TEAM_VIEWER
  const sorted = members.sort((a, b) => {
    const aOrder = ROLE_HIERARCHY[a.role] ?? -1;
    const bOrder = ROLE_HIERARCHY[b.role] ?? -1;
    if (aOrder !== bOrder) return bOrder - aOrder; // higher role first
    return a.joinedAt.getTime() - b.joinedAt.getTime();
  });

  return sorted.map((m) => ({
    userId: m.user.id,
    email: m.user.email,
    username: m.user.username,
    avatarData: m.user.avatarData,
    role: m.role,
    joinedAt: m.joinedAt,
  }));
}

export async function addMember(
  teamId: string,
  targetUserId: string,
  role: 'TEAM_ADMIN' | 'TEAM_EDITOR' | 'TEAM_VIEWER',
  addedByUserId: string
) {
  // Load team to check tenant
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { tenantId: true },
  });
  if (!team) throw new AppError('Team not found', 404);

  // Verify target user is in the same tenant
  const targetMembership = await prisma.tenantMember.findUnique({
    where: { tenantId_userId: { tenantId: team.tenantId, userId: targetUserId } },
  });
  if (!targetMembership) {
    throw new AppError('User is not a member of this organization', 400);
  }

  // Check not already a member
  const existing = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: targetUserId } },
  });
  if (existing) throw new AppError('User is already a team member', 400);

  // Both vaults must be unlocked
  const adderMasterKey = getMasterKey(addedByUserId);
  if (!adderMasterKey) {
    throw new AppError('Your vault is locked. Please unlock it first.', 403);
  }

  const targetMasterKey = getMasterKey(targetUserId);
  if (!targetMasterKey) {
    throw new AppError("Target user's vault is locked. They must unlock their vault first.", 403);
  }

  // Get team key: try cache first, then decrypt from DB
  let teamKey = getCachedTeamKey(teamId, addedByUserId);
  let decryptedFromDb = false;

  if (!teamKey) {
    const adderMember = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: addedByUserId } },
    });
    if (
      !adderMember?.encryptedTeamVaultKey ||
      !adderMember?.teamVaultKeyIV ||
      !adderMember?.teamVaultKeyTag
    ) {
      throw new AppError('Unable to access team vault key', 500);
    }

    const encField: EncryptedField = {
      ciphertext: adderMember.encryptedTeamVaultKey,
      iv: adderMember.teamVaultKeyIV,
      tag: adderMember.teamVaultKeyTag,
    };
    teamKey = decryptTeamKey(encField, adderMasterKey);
    storeTeamVaultSession(teamId, addedByUserId, teamKey);
    decryptedFromDb = true;
  }

  // Encrypt team key for the new member
  const encKey = encryptTeamKey(teamKey, targetMasterKey);

  const member = await prisma.teamMember.create({
    data: {
      teamId,
      userId: targetUserId,
      role,
      encryptedTeamVaultKey: encKey.ciphertext,
      teamVaultKeyIV: encKey.iv,
      teamVaultKeyTag: encKey.tag,
    },
  });

  // Zero out if we decrypted from DB
  if (decryptedFromDb) {
    teamKey.fill(0);
  }

  return {
    userId: targetUserId,
    role: member.role,
    joinedAt: member.joinedAt,
  };
}

export async function removeMember(
  teamId: string,
  targetUserId: string,
  _actingUserId: string
) {
  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: targetUserId } },
  });
  if (!membership) throw new AppError('Member not found', 404);

  // Last admin protection
  if (membership.role === 'TEAM_ADMIN') {
    const adminCount = await prisma.teamMember.count({
      where: { teamId, role: 'TEAM_ADMIN' },
    });
    if (adminCount <= 1) {
      throw new AppError('Cannot remove the last team admin', 400);
    }
  }

  await prisma.teamMember.delete({
    where: { teamId_userId: { teamId, userId: targetUserId } },
  });

  return { removed: true };
}

export async function updateMemberRole(
  teamId: string,
  targetUserId: string,
  newRole: 'TEAM_ADMIN' | 'TEAM_EDITOR' | 'TEAM_VIEWER',
  _actingUserId: string
) {
  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: targetUserId } },
  });
  if (!membership) throw new AppError('Member not found', 404);

  // Demotion protection: cannot demote the last TEAM_ADMIN
  if (membership.role === 'TEAM_ADMIN' && newRole !== 'TEAM_ADMIN') {
    const adminCount = await prisma.teamMember.count({
      where: { teamId, role: 'TEAM_ADMIN' },
    });
    if (adminCount <= 1) {
      throw new AppError('Cannot demote the last team admin', 400);
    }
  }

  const updated = await prisma.teamMember.update({
    where: { teamId_userId: { teamId, userId: targetUserId } },
    data: { role: newRole },
  });

  return { userId: targetUserId, role: updated.role };
}

export async function resolveTeamKey(teamId: string, userId: string): Promise<Buffer> {
  // Try cache first
  const cached = getCachedTeamKey(teamId, userId);
  if (cached) return cached;

  // Get user's personal master key
  const userMasterKey = getMasterKey(userId);
  if (!userMasterKey) {
    throw new AppError('Vault is locked. Please unlock it first.', 403);
  }

  // Load from DB and decrypt
  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
  });
  if (
    !membership?.encryptedTeamVaultKey ||
    !membership?.teamVaultKeyIV ||
    !membership?.teamVaultKeyTag
  ) {
    throw new AppError('Team vault key not found', 404);
  }

  const encField: EncryptedField = {
    ciphertext: membership.encryptedTeamVaultKey,
    iv: membership.teamVaultKeyIV,
    tag: membership.teamVaultKeyTag,
  };
  const teamKey = decryptTeamKey(encField, userMasterKey);
  storeTeamVaultSession(teamId, userId, teamKey);

  return teamKey;
}
