import prisma from '../lib/prisma';
import { AppError } from '../middleware/error.middleware';
import * as permissionService from './permission.service';
import { tenantScopedTeamFilter } from '../utils/tenantScope';

export async function createFolder(
  userId: string,
  name: string,
  parentId?: string,
  teamId?: string,
  tenantId?: string | null
) {
  if (teamId) {
    const perm = await permissionService.canManageTeamResource(userId, teamId, 'TEAM_EDITOR', tenantId);
    if (!perm.allowed) throw new AppError('Insufficient team role to create folders', 403);
  }

  if (parentId) {
    // Parent must be in the same scope
    const parent = await prisma.folder.findFirst({
      where: teamId
        ? { id: parentId, teamId }
        : { id: parentId, userId, teamId: null },
    });
    if (!parent) throw new AppError('Parent folder not found', 404);
  }

  return prisma.folder.create({
    data: {
      name,
      parentId: parentId || null,
      userId,
      teamId: teamId || null,
    },
  });
}

export async function updateFolder(
  userId: string,
  folderId: string,
  data: { name?: string; parentId?: string | null },
  tenantId?: string | null
) {
  const access = await permissionService.canManageFolder(userId, folderId, tenantId);
  if (!access.allowed) throw new AppError('Folder not found', 404);

  const folder = access.folder;

  // Prevent circular references
  if (data.parentId) {
    if (data.parentId === folderId) {
      throw new AppError('A folder cannot be its own parent', 400);
    }
    // Parent must be in the same scope
    const parent = await prisma.folder.findFirst({
      where: folder.teamId
        ? { id: data.parentId, teamId: folder.teamId }
        : { id: data.parentId, userId, teamId: null },
    });
    if (!parent) throw new AppError('Parent folder not found', 404);
  }

  return prisma.folder.update({
    where: { id: folderId },
    data: {
      name: data.name ?? folder.name,
      parentId: data.parentId !== undefined ? data.parentId : folder.parentId,
    },
  });
}

export async function deleteFolder(userId: string, folderId: string, tenantId?: string | null) {
  const access = await permissionService.canManageFolder(userId, folderId, tenantId);
  if (!access.allowed) throw new AppError('Folder not found', 404);

  const folder = access.folder;

  // Move connections and child folders to parent (scoped to same ownership)
  if (folder.teamId) {
    await prisma.connection.updateMany({
      where: { folderId, teamId: folder.teamId },
      data: { folderId: null },
    });
    await prisma.folder.updateMany({
      where: { parentId: folderId, teamId: folder.teamId },
      data: { parentId: folder.parentId },
    });
  } else {
    await prisma.connection.updateMany({
      where: { folderId, userId },
      data: { folderId: null },
    });
    await prisma.folder.updateMany({
      where: { parentId: folderId, userId },
      data: { parentId: folder.parentId },
    });
  }

  await prisma.folder.delete({ where: { id: folderId } });
  return { deleted: true };
}

export async function getFolderTree(userId: string, tenantId?: string | null) {
  // Personal folders
  const personalFolders = await prisma.folder.findMany({
    where: { userId, teamId: null },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

  // Team folders
  const teamMemberships = await prisma.teamMember.findMany({
    where: { userId, ...tenantScopedTeamFilter(tenantId) },
    select: { teamId: true, team: { select: { name: true } } },
  });

  let teamFolders: Array<Record<string, unknown>> = [];
  if (teamMemberships.length > 0) {
    const teamIds = teamMemberships.map((m) => m.teamId);
    const teamNameMap = new Map(teamMemberships.map((m) => [m.teamId, m.team.name]));

    const rawFolders = await prisma.folder.findMany({
      where: { teamId: { in: teamIds } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    teamFolders = rawFolders.map((f) => ({
      ...f,
      teamName: teamNameMap.get(f.teamId!) ?? null,
      scope: 'team' as const,
    }));
  }

  return {
    personal: personalFolders.map((f) => ({ ...f, scope: 'private' as const })),
    team: teamFolders,
  };
}
