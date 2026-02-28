import prisma from '../lib/prisma';
import { AppError } from '../middleware/error.middleware';
import { getMasterKey } from './crypto.service';
import { resolveTeamKey } from './team.service';

export const ROLE_HIERARCHY: Record<string, number> = {
  TEAM_VIEWER: 0,
  TEAM_EDITOR: 1,
  TEAM_ADMIN: 2,
};

type AccessType = 'owner' | 'team' | 'shared';

interface ViewConnectionResult {
  allowed: boolean;
  connection: any;
  accessType: AccessType;
  teamRole?: string;
}

interface ManageConnectionResult {
  allowed: boolean;
  connection: any;
  accessType: 'owner' | 'team';
  teamRole?: string;
}

interface ManageTeamResourceResult {
  allowed: boolean;
  role?: string;
}

interface FolderAccessResult {
  allowed: boolean;
  folder: any;
  accessType: 'owner' | 'team';
  teamRole?: string;
}

export async function canViewConnection(
  userId: string,
  connectionId: string
): Promise<ViewConnectionResult> {
  const connection = await prisma.connection.findUnique({
    where: { id: connectionId },
  });
  if (!connection) {
    return { allowed: false, connection: null, accessType: 'owner' };
  }

  // Owner check (personal connection: userId matches AND teamId is null)
  if (connection.userId === userId && !connection.teamId) {
    return { allowed: true, connection, accessType: 'owner' };
  }

  // Team check (connection belongs to a team the user is member of)
  if (connection.teamId) {
    const membership = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: connection.teamId, userId } },
    });
    if (membership) {
      return { allowed: true, connection, accessType: 'team', teamRole: membership.role };
    }
  }

  // Shared check
  const shared = await prisma.sharedConnection.findFirst({
    where: { connectionId, sharedWithUserId: userId },
  });
  if (shared) {
    return { allowed: true, connection, accessType: 'shared' };
  }

  return { allowed: false, connection: null, accessType: 'owner' };
}

export async function canManageConnection(
  userId: string,
  connectionId: string
): Promise<ManageConnectionResult> {
  const connection = await prisma.connection.findUnique({
    where: { id: connectionId },
  });
  if (!connection) {
    return { allowed: false, connection: null, accessType: 'owner' };
  }

  // Team connection: check TEAM_EDITOR+ role
  if (connection.teamId) {
    const membership = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: connection.teamId, userId } },
    });
    if (membership && ROLE_HIERARCHY[membership.role] >= ROLE_HIERARCHY['TEAM_EDITOR']) {
      return { allowed: true, connection, accessType: 'team', teamRole: membership.role };
    }
    return { allowed: false, connection: null, accessType: 'team' };
  }

  // Personal connection: owner check
  if (connection.userId === userId) {
    return { allowed: true, connection, accessType: 'owner' };
  }

  return { allowed: false, connection: null, accessType: 'owner' };
}

export async function canManageTeamResource(
  userId: string,
  teamId: string,
  minRole: 'TEAM_VIEWER' | 'TEAM_EDITOR' | 'TEAM_ADMIN'
): Promise<ManageTeamResourceResult> {
  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
  });
  if (!membership) {
    return { allowed: false };
  }
  const allowed = ROLE_HIERARCHY[membership.role] >= ROLE_HIERARCHY[minRole];
  return { allowed, role: membership.role };
}

export async function canViewFolder(
  userId: string,
  folderId: string
): Promise<FolderAccessResult> {
  const folder = await prisma.folder.findUnique({
    where: { id: folderId },
  });
  if (!folder) {
    return { allowed: false, folder: null, accessType: 'owner' };
  }

  // Team folder: any team member can view
  if (folder.teamId) {
    const membership = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: folder.teamId, userId } },
    });
    if (membership) {
      return { allowed: true, folder, accessType: 'team', teamRole: membership.role };
    }
    return { allowed: false, folder: null, accessType: 'team' };
  }

  // Personal folder: owner check
  if (folder.userId === userId) {
    return { allowed: true, folder, accessType: 'owner' };
  }

  return { allowed: false, folder: null, accessType: 'owner' };
}

export async function canManageFolder(
  userId: string,
  folderId: string
): Promise<FolderAccessResult> {
  const folder = await prisma.folder.findUnique({
    where: { id: folderId },
  });
  if (!folder) {
    return { allowed: false, folder: null, accessType: 'owner' };
  }

  // Team folder: TEAM_EDITOR+ can manage
  if (folder.teamId) {
    const membership = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: folder.teamId, userId } },
    });
    if (membership && ROLE_HIERARCHY[membership.role] >= ROLE_HIERARCHY['TEAM_EDITOR']) {
      return { allowed: true, folder, accessType: 'team', teamRole: membership.role };
    }
    return { allowed: false, folder: null, accessType: 'team' };
  }

  // Personal folder: owner check
  if (folder.userId === userId) {
    return { allowed: true, folder, accessType: 'owner' };
  }

  return { allowed: false, folder: null, accessType: 'owner' };
}

export async function resolveEncryptionKey(
  userId: string,
  teamId?: string | null
): Promise<Buffer> {
  if (teamId) {
    return resolveTeamKey(teamId, userId);
  }
  const key = getMasterKey(userId);
  if (!key) throw new AppError('Vault is locked. Please unlock it first.', 403);
  return key;
}
