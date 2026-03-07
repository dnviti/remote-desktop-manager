import prisma, { Prisma, ConnectionType } from '../lib/prisma';
import { encrypt, decrypt, getMasterKey } from './crypto.service';
import { AppError } from '../middleware/error.middleware';
import { resolveTeamKey } from './team.service';
import { resolveSecretEncryptionKey } from './secret.service';
import * as permissionService from './permission.service';
import { ROLE_HIERARCHY } from './permission.service';
import { tenantScopedTeamFilter } from '../utils/tenantScope';
import type { ResolvedCredentials, SecretPayload } from '../types';
import { logger } from '../utils/logger';

const log = logger.child('connection');

function requireMasterKey(userId: string): Buffer {
  const key = getMasterKey(userId);
  if (!key) throw new AppError('Vault is locked. Please unlock it first.', 403);
  return key;
}

export interface CreateConnectionInput {
  name: string;
  type: ConnectionType;
  host: string;
  port: number;
  username?: string;
  password?: string;
  domain?: string;
  credentialSecretId?: string;
  description?: string;
  folderId?: string;
  teamId?: string;
  enableDrive?: boolean;
  gatewayId?: string | null;
  sshTerminalConfig?: Prisma.InputJsonValue | null;
  rdpSettings?: Prisma.InputJsonValue | null;
  defaultCredentialMode?: string | null;
}

export interface UpdateConnectionInput {
  name?: string;
  type?: ConnectionType;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  domain?: string;
  credentialSecretId?: string | null;
  description?: string | null;
  folderId?: string | null;
  enableDrive?: boolean;
  gatewayId?: string | null;
  sshTerminalConfig?: Prisma.InputJsonValue | null;
  rdpSettings?: Prisma.InputJsonValue | null;
  defaultCredentialMode?: string | null;
}

export async function createConnection(userId: string, input: CreateConnectionInput, tenantId?: string | null) {
  // Validate: must provide EITHER credentialSecretId OR (username + password)
  if (!input.credentialSecretId && (input.username === undefined || input.password === undefined)) {
    throw new AppError('Either credentialSecretId or both username and password must be provided', 400);
  }

  // If credentialSecretId: validate access and type compatibility
  if (input.credentialSecretId) {
    const secretAccess = await permissionService.canViewSecret(userId, input.credentialSecretId, tenantId);
    if (!secretAccess.allowed) throw new AppError('Credential secret not found or inaccessible', 404);
    const secret = secretAccess.secret;
    if (secret.type !== 'LOGIN' && secret.type !== 'SSH_KEY') {
      throw new AppError('Credential secret must be of type LOGIN or SSH_KEY', 400);
    }
    if (input.type === 'RDP' && secret.type === 'SSH_KEY') {
      throw new AppError('SSH_KEY secrets cannot be used with RDP connections', 400);
    }
  }

  // Team permission check
  if (input.teamId) {
    const perm = await permissionService.canManageTeamResource(userId, input.teamId, 'TEAM_EDITOR', tenantId);
    if (!perm.allowed) throw new AppError('Insufficient team role to create connections', 403);
  }

  // Encrypt inline credentials if provided
  let encUsername = null;
  let encPassword = null;
  let encDomain = null;
  if (input.username !== undefined && input.password !== undefined) {
    const encryptionKey = input.teamId
      ? await resolveTeamKey(input.teamId, userId)
      : requireMasterKey(userId);
    encUsername = encrypt(input.username, encryptionKey);
    encPassword = encrypt(input.password, encryptionKey);
    if (input.domain) {
      encDomain = encrypt(input.domain, encryptionKey);
    }
  }

  const connection = await prisma.connection.create({
    data: {
      name: input.name,
      type: input.type,
      host: input.host,
      port: input.port,
      folderId: input.folderId || null,
      teamId: input.teamId || null,
      credentialSecretId: input.credentialSecretId || null,
      encryptedUsername: encUsername?.ciphertext ?? null,
      usernameIV: encUsername?.iv ?? null,
      usernameTag: encUsername?.tag ?? null,
      encryptedPassword: encPassword?.ciphertext ?? null,
      passwordIV: encPassword?.iv ?? null,
      passwordTag: encPassword?.tag ?? null,
      encryptedDomain: encDomain?.ciphertext ?? null,
      domainIV: encDomain?.iv ?? null,
      domainTag: encDomain?.tag ?? null,
      description: input.description || null,
      enableDrive: input.enableDrive ?? false,
      gatewayId: input.gatewayId || null,
      sshTerminalConfig: input.sshTerminalConfig ?? undefined,
      rdpSettings: input.rdpSettings ?? undefined,
      defaultCredentialMode: input.defaultCredentialMode ?? null,
      userId,
    },
  });

  log.debug(`Created connection ${connection.id} (${input.type}) for user ${userId}`);

  return {
    id: connection.id,
    name: connection.name,
    type: connection.type,
    host: connection.host,
    port: connection.port,
    folderId: connection.folderId,
    teamId: connection.teamId,
    gatewayId: connection.gatewayId,
    credentialSecretId: connection.credentialSecretId,
    description: connection.description,
    enableDrive: connection.enableDrive,
    sshTerminalConfig: connection.sshTerminalConfig,
    rdpSettings: connection.rdpSettings,
    defaultCredentialMode: connection.defaultCredentialMode,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

export async function updateConnection(
  userId: string,
  connectionId: string,
  input: UpdateConnectionInput,
  tenantId?: string | null
) {
  const access = await permissionService.canManageConnection(userId, connectionId, tenantId);
  if (!access.allowed) throw new AppError('Connection not found', 404);

  const connection = access.connection;
  const encryptionKey = await permissionService.resolveEncryptionKey(userId, connection.teamId);

  const data: Record<string, unknown> = {};

  if (input.name !== undefined) data.name = input.name;
  if (input.type !== undefined) data.type = input.type;
  if (input.host !== undefined) data.host = input.host;
  if (input.port !== undefined) data.port = input.port;
  if (input.description !== undefined) data.description = input.description;
  if (input.folderId !== undefined) data.folderId = input.folderId;
  if (input.enableDrive !== undefined) data.enableDrive = input.enableDrive;
  if (input.gatewayId !== undefined) data.gatewayId = input.gatewayId;
  if (input.sshTerminalConfig !== undefined) data.sshTerminalConfig = input.sshTerminalConfig;
  if (input.rdpSettings !== undefined) data.rdpSettings = input.rdpSettings;
  if (input.defaultCredentialMode !== undefined) data.defaultCredentialMode = input.defaultCredentialMode;

  // Handle credentialSecretId changes
  if (input.credentialSecretId !== undefined) {
    if (input.credentialSecretId === null) {
      // Clearing vault secret reference
      data.credentialSecretId = null;
    } else {
      // Setting vault secret reference: validate access and type
      const secretAccess = await permissionService.canViewSecret(userId, input.credentialSecretId, tenantId);
      if (!secretAccess.allowed) throw new AppError('Credential secret not found or inaccessible', 404);
      const connType = input.type || connection.type;
      if (secretAccess.secret.type !== 'LOGIN' && secretAccess.secret.type !== 'SSH_KEY') {
        throw new AppError('Credential secret must be of type LOGIN or SSH_KEY', 400);
      }
      if (connType === 'RDP' && secretAccess.secret.type === 'SSH_KEY') {
        throw new AppError('SSH_KEY secrets cannot be used with RDP connections', 400);
      }
      data.credentialSecretId = input.credentialSecretId;
      // Clear inline credentials when switching to vault secret
      data.encryptedUsername = null;
      data.usernameIV = null;
      data.usernameTag = null;
      data.encryptedPassword = null;
      data.passwordIV = null;
      data.passwordTag = null;
      data.encryptedDomain = null;
      data.domainIV = null;
      data.domainTag = null;
    }
  }

  if (input.username !== undefined) {
    const enc = encrypt(input.username, encryptionKey);
    data.encryptedUsername = enc.ciphertext;
    data.usernameIV = enc.iv;
    data.usernameTag = enc.tag;
  }

  if (input.password !== undefined) {
    const enc = encrypt(input.password, encryptionKey);
    data.encryptedPassword = enc.ciphertext;
    data.passwordIV = enc.iv;
    data.passwordTag = enc.tag;
  }

  if (input.domain !== undefined) {
    if (input.domain) {
      const enc = encrypt(input.domain, encryptionKey);
      data.encryptedDomain = enc.ciphertext;
      data.domainIV = enc.iv;
      data.domainTag = enc.tag;
    } else {
      data.encryptedDomain = null;
      data.domainIV = null;
      data.domainTag = null;
    }
  }

  const updated = await prisma.connection.update({
    where: { id: connectionId },
    data,
  });

  log.debug(`Updated connection ${connectionId} for user ${userId}`);

  return {
    id: updated.id,
    name: updated.name,
    type: updated.type,
    host: updated.host,
    port: updated.port,
    folderId: updated.folderId,
    teamId: updated.teamId,
    gatewayId: updated.gatewayId,
    credentialSecretId: updated.credentialSecretId,
    description: updated.description,
    enableDrive: updated.enableDrive,
    sshTerminalConfig: updated.sshTerminalConfig,
    rdpSettings: updated.rdpSettings,
    defaultCredentialMode: updated.defaultCredentialMode,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  };
}

export async function deleteConnection(userId: string, connectionId: string, tenantId?: string | null) {
  const access = await permissionService.canManageConnection(userId, connectionId, tenantId);
  if (!access.allowed) throw new AppError('Connection not found', 404);

  await prisma.connection.delete({ where: { id: connectionId } });
  log.debug(`Deleted connection ${connectionId} for user ${userId}`);
  return { deleted: true };
}

export async function getConnection(userId: string, connectionId: string, tenantId?: string | null) {
  const access = await permissionService.canViewConnection(userId, connectionId, tenantId);
  if (!access.allowed) throw new AppError('Connection not found', 404);

  const connection = access.connection;

  const credSecret = connection.credentialSecret;
  const credentialSecretId = connection.credentialSecretId ?? null;
  const credentialSecretName = credSecret?.name ?? null;
  const credentialSecretType = credSecret?.type ?? null;

  if (access.accessType === 'owner') {
    return {
      id: connection.id,
      name: connection.name,
      type: connection.type,
      host: connection.host,
      port: connection.port,
      folderId: connection.folderId,
      teamId: connection.teamId,
      credentialSecretId,
      credentialSecretName,
      credentialSecretType,
      description: connection.description,
      enableDrive: connection.enableDrive,
      sshTerminalConfig: connection.sshTerminalConfig,
      rdpSettings: connection.rdpSettings,
      defaultCredentialMode: connection.defaultCredentialMode,
      gatewayId: connection.gatewayId,
      gateway: connection.gateway,
      isOwner: true,
      scope: 'private' as const,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    };
  }

  if (access.accessType === 'team') {
    return {
      id: connection.id,
      name: connection.name,
      type: connection.type,
      host: connection.host,
      port: connection.port,
      folderId: connection.folderId,
      teamId: connection.teamId,
      credentialSecretId,
      credentialSecretName,
      credentialSecretType,
      description: connection.description,
      enableDrive: connection.enableDrive,
      sshTerminalConfig: connection.sshTerminalConfig,
      rdpSettings: connection.rdpSettings,
      defaultCredentialMode: connection.defaultCredentialMode,
      gatewayId: connection.gatewayId,
      gateway: connection.gateway,
      isOwner: false,
      scope: 'team' as const,
      teamRole: access.teamRole,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    };
  }

  // Shared
  const shared = await prisma.sharedConnection.findFirst({
    where: { connectionId, sharedWithUserId: userId },
  });
  return {
    id: connection.id,
    name: connection.name,
    type: connection.type,
    host: connection.host,
    port: connection.port,
    folderId: null,
    teamId: null,
    credentialSecretId,
    credentialSecretName,
    credentialSecretType,
    description: connection.description,
    enableDrive: connection.enableDrive,
    sshTerminalConfig: connection.sshTerminalConfig,
    rdpSettings: connection.rdpSettings,
    defaultCredentialMode: connection.defaultCredentialMode,
    gatewayId: connection.gatewayId,
    gateway: connection.gateway,
    isOwner: false,
    scope: 'shared' as const,
    permission: shared?.permission,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

export async function listConnections(userId: string, tenantId?: string | null) {
  // Personal connections (exclude team connections)
  const ownConnections = await prisma.connection.findMany({
    where: { userId, teamId: null },
    select: {
      id: true,
      name: true,
      type: true,
      host: true,
      port: true,
      folderId: true,
      gatewayId: true,
      credentialSecretId: true,
      credentialSecret: { select: { name: true, type: true } },
      description: true,
      isFavorite: true,
      enableDrive: true,
      sshTerminalConfig: true,
      rdpSettings: true,
      defaultCredentialMode: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { name: 'asc' },
  });

  // Shared connections
  const sharedConnections = await prisma.sharedConnection.findMany({
    where: { sharedWithUserId: userId },
    include: {
      connection: {
        select: {
          id: true,
          name: true,
          type: true,
          host: true,
          port: true,
          gatewayId: true,
          credentialSecretId: true,
          credentialSecret: { select: { name: true, type: true } },
          description: true,
          enableDrive: true,
          sshTerminalConfig: true,
          rdpSettings: true,
          defaultCredentialMode: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      sharedBy: { select: { email: true } },
    },
  });

  // Team connections
  const userTeamMemberships = await prisma.teamMember.findMany({
    where: { userId, ...tenantScopedTeamFilter(tenantId) },
    select: { teamId: true, role: true, team: { select: { name: true } } },
  });

  let teamConnections: Array<Record<string, unknown>> = [];
  if (userTeamMemberships.length > 0) {
    const teamIdList = userTeamMemberships.map((m) => m.teamId);
    const teamNameMap = new Map(userTeamMemberships.map((m) => [m.teamId, m.team.name]));
    const teamRoleMap = new Map(userTeamMemberships.map((m) => [m.teamId, m.role]));

    const rawTeamConns = await prisma.connection.findMany({
      where: { teamId: { in: teamIdList } },
      select: {
        id: true,
        name: true,
        type: true,
        host: true,
        port: true,
        folderId: true,
        teamId: true,
        gatewayId: true,
        credentialSecretId: true,
        credentialSecret: { select: { name: true, type: true } },
        description: true,
        isFavorite: true,
        enableDrive: true,
        sshTerminalConfig: true,
        rdpSettings: true,
        defaultCredentialMode: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { name: 'asc' },
    });

    teamConnections = rawTeamConns.map((c) => ({
      ...c,
      credentialSecretName: c.credentialSecret?.name ?? null,
      credentialSecretType: c.credentialSecret?.type ?? null,
      teamName: teamNameMap.get(c.teamId!) ?? null,
      teamRole: teamRoleMap.get(c.teamId!) ?? null,
      isOwner: false,
      scope: 'team' as const,
    }));
  }

  return {
    own: ownConnections.map((c: (typeof ownConnections)[number]) => ({
      ...c,
      credentialSecretName: c.credentialSecret?.name ?? null,
      credentialSecretType: c.credentialSecret?.type ?? null,
      isOwner: true,
      scope: 'private' as const,
    })),
    shared: sharedConnections.map((s: (typeof sharedConnections)[number]) => ({
      ...s.connection,
      credentialSecretName: s.connection.credentialSecret?.name ?? null,
      credentialSecretType: s.connection.credentialSecret?.type ?? null,
      folderId: null,
      isOwner: false,
      isFavorite: false,
      permission: s.permission,
      sharedBy: s.sharedBy.email,
      scope: 'shared' as const,
    })),
    team: teamConnections,
  };
}

async function resolveCredentialsFromSecret(
  userId: string,
  credentialSecretId: string,
  connectionType: ConnectionType,
  tenantId?: string | null
): Promise<ResolvedCredentials> {
  const access = await permissionService.canViewSecret(userId, credentialSecretId, tenantId);
  if (!access.allowed) throw new AppError('Credential secret not found or inaccessible', 404);

  const secret = access.secret;
  let decryptedData: SecretPayload;

  if (access.accessType === 'shared') {
    const sharedRecord = await prisma.sharedSecret.findFirst({
      where: { secretId: credentialSecretId, sharedWithUserId: userId },
    });
    if (!sharedRecord) throw new AppError('Credential secret not found', 404);
    const personalKey = requireMasterKey(userId);
    decryptedData = JSON.parse(
      decrypt({ ciphertext: sharedRecord.encryptedData, iv: sharedRecord.dataIV, tag: sharedRecord.dataTag }, personalKey)
    );
  } else {
    const encryptionKey = await resolveSecretEncryptionKey(
      userId, secret.scope, secret.teamId, secret.tenantId
    );
    decryptedData = JSON.parse(
      decrypt({ ciphertext: secret.encryptedData, iv: secret.dataIV, tag: secret.dataTag }, encryptionKey)
    );
  }

  if (decryptedData.type === 'LOGIN') {
    return { username: decryptedData.username, password: decryptedData.password, domain: decryptedData.domain };
  }

  if (decryptedData.type === 'SSH_KEY') {
    if (connectionType === 'RDP') {
      throw new AppError('SSH_KEY secrets cannot be used with RDP connections', 400);
    }
    return {
      username: decryptedData.username || '',
      password: '',
      privateKey: decryptedData.privateKey,
      passphrase: decryptedData.passphrase,
    };
  }

  throw new AppError(
    `Secret type "${decryptedData.type}" is not compatible with connection credentials. Use LOGIN or SSH_KEY.`,
    400
  );
}

function decryptDomain(
  record: { encryptedDomain: string | null; domainIV: string | null; domainTag: string | null },
  key: Buffer
): string | undefined {
  if (record.encryptedDomain && record.domainIV && record.domainTag) {
    return decrypt({ ciphertext: record.encryptedDomain, iv: record.domainIV, tag: record.domainTag }, key);
  }
  return undefined;
}

export async function getConnectionCredentials(
  userId: string,
  connectionId: string,
  tenantId?: string | null
): Promise<ResolvedCredentials> {
  const access = await permissionService.canViewConnection(userId, connectionId, tenantId);
  if (!access.allowed) throw new AppError('Connection not found or credentials unavailable', 404);

  const connection = access.connection;

  // Vault secret reference: resolve credentials from keychain
  if (connection.credentialSecretId) {
    const creds = await resolveCredentialsFromSecret(
      userId, connection.credentialSecretId, connection.type, tenantId
    );
    // If SSH_KEY secret has no username, fall back to inline encrypted username
    if (!creds.username && connection.encryptedUsername && connection.usernameIV && connection.usernameTag) {
      const key = access.accessType === 'team'
        ? await resolveTeamKey(connection.teamId!, userId)
        : requireMasterKey(userId);
      creds.username = decrypt(
        { ciphertext: connection.encryptedUsername, iv: connection.usernameIV, tag: connection.usernameTag },
        key
      );
    }
    // If secret has no domain, fall back to inline encrypted domain
    if (!creds.domain && connection.encryptedDomain && connection.domainIV && connection.domainTag) {
      const key = access.accessType === 'team'
        ? await resolveTeamKey(connection.teamId!, userId)
        : requireMasterKey(userId);
      creds.domain = decryptDomain(connection, key);
    }
    return creds;
  }

  // Inline credentials: guard against nulls
  if (!connection.encryptedUsername || !connection.usernameIV || !connection.usernameTag ||
      !connection.encryptedPassword || !connection.passwordIV || !connection.passwordTag) {
    throw new AppError('Connection has no credentials configured', 400);
  }

  if (access.accessType === 'owner') {
    const masterKey = requireMasterKey(userId);
    return {
      username: decrypt(
        { ciphertext: connection.encryptedUsername, iv: connection.usernameIV, tag: connection.usernameTag },
        masterKey
      ),
      password: decrypt(
        { ciphertext: connection.encryptedPassword, iv: connection.passwordIV, tag: connection.passwordTag },
        masterKey
      ),
      domain: decryptDomain(connection, masterKey),
    };
  }

  if (access.accessType === 'team') {
    const teamKey = await resolveTeamKey(connection.teamId!, userId);
    return {
      username: decrypt(
        { ciphertext: connection.encryptedUsername, iv: connection.usernameIV, tag: connection.usernameTag },
        teamKey
      ),
      password: decrypt(
        { ciphertext: connection.encryptedPassword, iv: connection.passwordIV, tag: connection.passwordTag },
        teamKey
      ),
      domain: decryptDomain(connection, teamKey),
    };
  }

  // Shared: decrypt from SharedConnection re-encrypted copy
  const masterKey = requireMasterKey(userId);
  const shared = await prisma.sharedConnection.findFirst({
    where: { connectionId, sharedWithUserId: userId },
  });

  if (shared?.encryptedUsername && shared.usernameIV && shared.usernameTag &&
      shared.encryptedPassword && shared.passwordIV && shared.passwordTag) {
    return {
      username: decrypt(
        { ciphertext: shared.encryptedUsername, iv: shared.usernameIV, tag: shared.usernameTag },
        masterKey
      ),
      password: decrypt(
        { ciphertext: shared.encryptedPassword, iv: shared.passwordIV, tag: shared.passwordTag },
        masterKey
      ),
      domain: decryptDomain(shared, masterKey),
    };
  }

  throw new AppError('Connection not found or credentials unavailable', 404);
}

export async function toggleFavorite(userId: string, connectionId: string, tenantId?: string | null) {
  const access = await permissionService.canViewConnection(userId, connectionId, tenantId);
  if (!access.allowed) throw new AppError('Connection not found', 404);

  if (access.accessType === 'shared') {
    throw new AppError('Cannot favorite shared connections', 403);
  }

  if (access.accessType === 'team') {
    if (ROLE_HIERARCHY[access.teamRole!] < ROLE_HIERARCHY['TEAM_EDITOR']) {
      throw new AppError('Viewers cannot toggle favorites on team connections', 403);
    }
  }

  const updated = await prisma.connection.update({
    where: { id: connectionId },
    data: { isFavorite: !access.connection.isFavorite },
  });

  log.debug(`Toggled favorite for connection ${connectionId} (now ${updated.isFavorite})`);
  return { id: updated.id, isFavorite: updated.isFavorite };
}
