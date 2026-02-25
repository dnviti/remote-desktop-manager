import { PrismaClient, ConnectionType } from '@prisma/client';
import { encrypt, decrypt, getMasterKey } from './crypto.service';
import { AppError } from '../middleware/error.middleware';

const prisma = new PrismaClient();

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
  username: string;
  password: string;
  description?: string;
  folderId?: string;
}

export interface UpdateConnectionInput {
  name?: string;
  type?: ConnectionType;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  description?: string;
  folderId?: string | null;
}

export async function createConnection(userId: string, input: CreateConnectionInput) {
  const masterKey = requireMasterKey(userId);

  const encUsername = encrypt(input.username, masterKey);
  const encPassword = encrypt(input.password, masterKey);

  const connection = await prisma.connection.create({
    data: {
      name: input.name,
      type: input.type,
      host: input.host,
      port: input.port,
      folderId: input.folderId || null,
      encryptedUsername: encUsername.ciphertext,
      usernameIV: encUsername.iv,
      usernameTag: encUsername.tag,
      encryptedPassword: encPassword.ciphertext,
      passwordIV: encPassword.iv,
      passwordTag: encPassword.tag,
      description: input.description || null,
      userId,
    },
  });

  return {
    id: connection.id,
    name: connection.name,
    type: connection.type,
    host: connection.host,
    port: connection.port,
    folderId: connection.folderId,
    description: connection.description,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

export async function updateConnection(
  userId: string,
  connectionId: string,
  input: UpdateConnectionInput
) {
  const connection = await prisma.connection.findFirst({
    where: { id: connectionId, userId },
  });
  if (!connection) throw new AppError('Connection not found', 404);

  const masterKey = requireMasterKey(userId);
  const data: Record<string, unknown> = {};

  if (input.name !== undefined) data.name = input.name;
  if (input.type !== undefined) data.type = input.type;
  if (input.host !== undefined) data.host = input.host;
  if (input.port !== undefined) data.port = input.port;
  if (input.description !== undefined) data.description = input.description;
  if (input.folderId !== undefined) data.folderId = input.folderId;

  if (input.username !== undefined) {
    const enc = encrypt(input.username, masterKey);
    data.encryptedUsername = enc.ciphertext;
    data.usernameIV = enc.iv;
    data.usernameTag = enc.tag;
  }

  if (input.password !== undefined) {
    const enc = encrypt(input.password, masterKey);
    data.encryptedPassword = enc.ciphertext;
    data.passwordIV = enc.iv;
    data.passwordTag = enc.tag;
  }

  const updated = await prisma.connection.update({
    where: { id: connectionId },
    data,
  });

  return {
    id: updated.id,
    name: updated.name,
    type: updated.type,
    host: updated.host,
    port: updated.port,
    folderId: updated.folderId,
    description: updated.description,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  };
}

export async function deleteConnection(userId: string, connectionId: string) {
  const connection = await prisma.connection.findFirst({
    where: { id: connectionId, userId },
  });
  if (!connection) throw new AppError('Connection not found', 404);

  await prisma.connection.delete({ where: { id: connectionId } });
  return { deleted: true };
}

export async function getConnection(userId: string, connectionId: string) {
  // Check own connections
  const connection = await prisma.connection.findFirst({
    where: { id: connectionId, userId },
  });
  if (connection) {
    return {
      id: connection.id,
      name: connection.name,
      type: connection.type,
      host: connection.host,
      port: connection.port,
      folderId: connection.folderId,
      description: connection.description,
      isOwner: true,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    };
  }

  // Check shared connections
  const shared = await prisma.sharedConnection.findFirst({
    where: { connectionId, sharedWithUserId: userId },
    include: { connection: true },
  });
  if (shared) {
    return {
      id: shared.connection.id,
      name: shared.connection.name,
      type: shared.connection.type,
      host: shared.connection.host,
      port: shared.connection.port,
      folderId: null,
      description: shared.connection.description,
      isOwner: false,
      permission: shared.permission,
      createdAt: shared.connection.createdAt,
      updatedAt: shared.connection.updatedAt,
    };
  }

  throw new AppError('Connection not found', 404);
}

export async function listConnections(userId: string) {
  const ownConnections = await prisma.connection.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      type: true,
      host: true,
      port: true,
      folderId: true,
      description: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { name: 'asc' },
  });

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
          description: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      sharedBy: { select: { email: true } },
    },
  });

  return {
    own: ownConnections.map((c) => ({ ...c, isOwner: true })),
    shared: sharedConnections.map((s) => ({
      ...s.connection,
      folderId: null,
      isOwner: false,
      permission: s.permission,
      sharedBy: s.sharedBy.email,
    })),
  };
}

export async function getConnectionCredentials(
  userId: string,
  connectionId: string
): Promise<{ username: string; password: string }> {
  const masterKey = requireMasterKey(userId);

  // Check own connections
  const connection = await prisma.connection.findFirst({
    where: { id: connectionId, userId },
  });

  if (connection) {
    return {
      username: decrypt(
        { ciphertext: connection.encryptedUsername, iv: connection.usernameIV, tag: connection.usernameTag },
        masterKey
      ),
      password: decrypt(
        { ciphertext: connection.encryptedPassword, iv: connection.passwordIV, tag: connection.passwordTag },
        masterKey
      ),
    };
  }

  // Check shared connections
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
    };
  }

  throw new AppError('Connection not found or credentials unavailable', 404);
}
