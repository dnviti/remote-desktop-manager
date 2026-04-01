import prisma from '../lib/prisma';
import { AppError } from '../middleware/error.middleware';
import { getMasterKey } from './crypto.service';
import { resolveTeamKey } from './team.service';
import { assertSameTenant } from '../utils/tenantScope';

export const ROLE_HIERARCHY: Record<string, number> = {
  TEAM_VIEWER: 0,
  TEAM_EDITOR: 1,
  TEAM_ADMIN: 2,
};

type AccessType = 'owner' | 'team' | 'shared';

interface ViewConnectionResult {
  allowed: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connection: any;
  accessType: AccessType;
  teamRole?: string;
}

interface ManageConnectionResult {
  allowed: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  folder: any;
  accessType: 'owner' | 'team';
  teamRole?: string;
}

export async function canViewConnection(
  userId: string,
  connectionId: string,
  tenantId?: string | null
): Promise<ViewConnectionResult> {
  const connection = await prisma.connection.findUnique({
    where: { id: connectionId },
    include: {
      team: { select: { tenantId: true } },
      gateway: { select: { id: true, type: true, host: true, port: true, deploymentMode: true, isManaged: true, lbStrategy: true, tunnelEnabled: true } },
      credentialSecret: { select: { id: true, name: true, type: true, scope: true, teamId: true, tenantId: true, encryptedData: true, dataIV: true, dataTag: true } },
    },
  });
  if (!connection) {
    return { allowed: false, connection: null, accessType: 'owner' };
  }

  // Tenant isolation check
  assertSameTenant(tenantId, connection.team?.tenantId);

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
  connectionId: string,
  tenantId?: string | null
): Promise<ManageConnectionResult> {
  const connection = await prisma.connection.findUnique({
    where: { id: connectionId },
    include: { team: { select: { tenantId: true } } },
  });
  if (!connection) {
    return { allowed: false, connection: null, accessType: 'owner' };
  }

  // Tenant isolation check
  assertSameTenant(tenantId, connection.team?.tenantId);

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
  minRole: 'TEAM_VIEWER' | 'TEAM_EDITOR' | 'TEAM_ADMIN',
  tenantId?: string | null
): Promise<ManageTeamResourceResult> {
  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
    include: { team: { select: { tenantId: true } } },
  });
  if (!membership) {
    return { allowed: false };
  }

  // Tenant isolation check
  assertSameTenant(tenantId, membership.team.tenantId);

  const allowed = ROLE_HIERARCHY[membership.role] >= ROLE_HIERARCHY[minRole];
  return { allowed, role: membership.role };
}

export async function canViewFolder(
  userId: string,
  folderId: string,
  tenantId?: string | null
): Promise<FolderAccessResult> {
  const folder = await prisma.folder.findUnique({
    where: { id: folderId },
    include: { team: { select: { tenantId: true } } },
  });
  if (!folder) {
    return { allowed: false, folder: null, accessType: 'owner' };
  }

  // Tenant isolation check
  assertSameTenant(tenantId, folder.team?.tenantId);

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
  folderId: string,
  tenantId?: string | null
): Promise<FolderAccessResult> {
  const folder = await prisma.folder.findUnique({
    where: { id: folderId },
    include: { team: { select: { tenantId: true } } },
  });
  if (!folder) {
    return { allowed: false, folder: null, accessType: 'owner' };
  }

  // Tenant isolation check
  assertSameTenant(tenantId, folder.team?.tenantId);

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

// Secret access types and result interfaces

type SecretAccessType = 'owner' | 'team' | 'tenant' | 'shared';

interface SecretAccessResult {
  allowed: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  secret: any;
  accessType: SecretAccessType;
  teamRole?: string;
}

export async function canViewSecret(
  userId: string,
  secretId: string,
  tenantId?: string | null
): Promise<SecretAccessResult> {
  const secret = await prisma.vaultSecret.findUnique({
    where: { id: secretId },
    include: {
      team: { select: { tenantId: true } },
    },
  });
  if (!secret) {
    return { allowed: false, secret: null, accessType: 'owner' };
  }

  // Tenant isolation check
  if (secret.scope === 'TEAM' && secret.team) {
    assertSameTenant(tenantId, secret.team.tenantId);
  }
  if (secret.scope === 'TENANT') {
    assertSameTenant(tenantId, secret.tenantId);
  }

  // PERSONAL: owner check
  if (secret.scope === 'PERSONAL') {
    if (secret.userId === userId) {
      return { allowed: true, secret, accessType: 'owner' };
    }
  }

  // TEAM: any team member can view
  if (secret.scope === 'TEAM' && secret.teamId) {
    const membership = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: secret.teamId, userId } },
    });
    if (membership) {
      return { allowed: true, secret, accessType: 'team', teamRole: membership.role };
    }
  }

  // TENANT: must have TenantVaultMember record
  if (secret.scope === 'TENANT' && secret.tenantId) {
    const tenantMember = await prisma.tenantVaultMember.findUnique({
      where: { tenantId_userId: { tenantId: secret.tenantId, userId } },
    });
    if (tenantMember) {
      return { allowed: true, secret, accessType: 'tenant' };
    }
  }

  // SHARED: check if someone shared this secret with the user
  const sharedSecret = await prisma.sharedSecret.findFirst({
    where: { secretId, sharedWithUserId: userId },
  });
  if (sharedSecret) {
    return { allowed: true, secret, accessType: 'shared' };
  }

  return { allowed: false, secret: null, accessType: 'owner' };
}

export async function canManageSecret(
  userId: string,
  secretId: string,
  tenantId?: string | null
): Promise<SecretAccessResult> {
  const secret = await prisma.vaultSecret.findUnique({
    where: { id: secretId },
    include: {
      team: { select: { tenantId: true } },
    },
  });
  if (!secret) {
    return { allowed: false, secret: null, accessType: 'owner' };
  }

  // Tenant isolation check
  if (secret.scope === 'TEAM' && secret.team) {
    assertSameTenant(tenantId, secret.team.tenantId);
  }
  if (secret.scope === 'TENANT') {
    assertSameTenant(tenantId, secret.tenantId);
  }

  // PERSONAL: owner check
  if (secret.scope === 'PERSONAL') {
    if (secret.userId === userId) {
      return { allowed: true, secret, accessType: 'owner' };
    }
    return { allowed: false, secret: null, accessType: 'owner' };
  }

  // TEAM: TEAM_EDITOR+ can manage
  if (secret.scope === 'TEAM' && secret.teamId) {
    const membership = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: secret.teamId, userId } },
    });
    if (membership && ROLE_HIERARCHY[membership.role] >= ROLE_HIERARCHY['TEAM_EDITOR']) {
      return { allowed: true, secret, accessType: 'team', teamRole: membership.role };
    }
    return { allowed: false, secret: null, accessType: 'team' };
  }

  // TENANT: ADMIN or OWNER only
  if (secret.scope === 'TENANT' && secret.tenantId) {
    const membership = await prisma.tenantMember.findUnique({
      where: { tenantId_userId: { tenantId: secret.tenantId, userId } },
      select: { role: true, status: true },
    });
    if (
      membership &&
      membership.status === 'ACCEPTED' &&
      (membership.role === 'OWNER' || membership.role === 'ADMIN')
    ) {
      return { allowed: true, secret, accessType: 'tenant' };
    }
    return { allowed: false, secret: null, accessType: 'tenant' };
  }

  return { allowed: false, secret: null, accessType: 'owner' };
}

export async function resolveEncryptionKey(
  userId: string,
  teamId?: string | null
): Promise<Buffer> {
  if (teamId) {
    return resolveTeamKey(teamId, userId);
  }
  const key = await getMasterKey(userId);
  if (!key) throw new AppError('Vault is locked. Please unlock it first.', 403);
  return key;
}
