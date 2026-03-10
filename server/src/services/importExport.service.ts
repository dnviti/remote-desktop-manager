import prisma, { ConnectionType } from '../lib/prisma';
import { encrypt, decrypt, getMasterKey } from './crypto.service';
import { AppError } from '../middleware/error.middleware';
import { generateCSV } from '../utils/csvParser';
import { parseMremotengXml, mapMremotengProtocol } from '../utils/mremoteNgParser';
import { parseRdpFile } from '../utils/rdpParser';
import { validateHost } from '../utils/hostValidation';
import type { CreateConnectionInput } from './connection.service';
import * as connectionService from './connection.service';
import * as folderService from './folder.service';

const BATCH_SIZE = 50;

export interface ExportOptions {
  format: 'CSV' | 'JSON';
  includeCredentials: boolean;
  userId: string;
  connectionIds?: string[];
  folderId?: string;
}

export interface ImportOptions {
  duplicateStrategy: 'SKIP' | 'OVERWRITE' | 'RENAME';
  userId: string;
  tenantId?: string;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  failed: number;
  errors: Array<{ row?: number; filename: string; error: string }>;
}

export interface ColumnMapping {
  name?: string;
  host?: string;
  port?: string;
  type?: string;
  username?: string;
  password?: string;
  folder?: string;
  description?: string;
  [key: string]: string | undefined;
}

export async function exportConnections(options: ExportOptions): Promise<{ filename: string; content: string }> {
  const { format, includeCredentials, userId, connectionIds, folderId } = options;

  const connections = await prisma.connection.findMany({
    where: {
      userId,
      ...(connectionIds && connectionIds.length > 0 ? { id: { in: connectionIds } } : {}),
      ...(folderId ? { folderId } : {}),
    },
    include: {
      folder: true,
    },
  });

  let content: string;
  let filename: string;

  if (format === 'JSON') {
    const exportData = await prepareJsonExport(connections, userId, includeCredentials);
    content = JSON.stringify(exportData, null, 2);
    filename = `arsenale-connections-${new Date().toISOString().split('T')[0]}.json`;
  } else {
    content = await prepareCsvExport(connections, userId, includeCredentials);
    filename = `connections-export-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  }

  return { filename, content };
}

async function prepareJsonExport(
  connections: Array<Awaited<ReturnType<typeof prisma.connection.findMany>>[number]>,
  userId: string,
  includeCredentials: boolean
): Promise<unknown> {
  const masterKey = includeCredentials ? getMasterKey(userId) : null;
  if (includeCredentials && !masterKey) {
    throw new AppError('Vault is locked. Cannot export credentials.', 403);
  }

  const folderIds = connections.map(c => c.folderId).filter((id): id is string => !!id);
  const folders = folderIds.length > 0 ? await prisma.folder.findMany({
    where: { id: { in: folderIds } },
  }) : [];
  const folderMap = new Map(folders.map(f => [f.id, f.name]));

  const exportData = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    count: connections.length,
    connections: connections.map((conn) => {
      const exported: Record<string, unknown> = {
        id: conn.id,
        name: conn.name,
        type: conn.type,
        host: conn.host,
        port: conn.port,
        description: conn.description,
        isFavorite: conn.isFavorite,
        enableDrive: conn.enableDrive,
        folderName: conn.folderId ? (folderMap.get(conn.folderId) || null) : null,
        sshTerminalConfig: conn.sshTerminalConfig,
        rdpSettings: conn.rdpSettings,
        vncSettings: conn.vncSettings,
        defaultCredentialMode: conn.defaultCredentialMode,
        createdAt: conn.createdAt.toISOString(),
        updatedAt: conn.updatedAt.toISOString(),
      };

      if (includeCredentials && masterKey) {
        if (conn.encryptedUsername && conn.usernameIV && conn.usernameTag) {
          try {
            exported.username = decrypt(
              { ciphertext: conn.encryptedUsername, iv: conn.usernameIV, tag: conn.usernameTag },
              masterKey
            );
          } catch {
            exported.username = null;
          }
        }
        if (conn.encryptedPassword && conn.passwordIV && conn.passwordTag) {
          try {
            exported.password = decrypt(
              { ciphertext: conn.encryptedPassword, iv: conn.passwordIV, tag: conn.passwordTag },
              masterKey
            );
          } catch {
            exported.password = null;
          }
        }
        if (conn.encryptedDomain && conn.domainIV && conn.domainTag) {
          try {
            exported.domain = decrypt(
              { ciphertext: conn.encryptedDomain, iv: conn.domainIV, tag: conn.domainTag },
              masterKey
            );
          } catch {
            exported.domain = null;
          }
        }
      }

      return exported;
    }),
  };

  return exportData;
}

async function prepareCsvExport(
  connections: Array<Awaited<ReturnType<typeof prisma.connection.findMany>>[number]>,
  userId: string,
  includeCredentials: boolean
): Promise<string> {
  const masterKey = includeCredentials ? getMasterKey(userId) : null;
  if (includeCredentials && !masterKey) {
    throw new AppError('Vault is locked. Cannot export credentials.', 403);
  }

  const folderIds = connections.map(c => c.folderId).filter((id): id is string => !!id);
  const folders = folderIds.length > 0 ? await prisma.folder.findMany({
    where: { id: { in: folderIds } },
  }) : [];
  const folderMap = new Map(folders.map(f => [f.id, f.name]));

  const headers = [
    'Name',
    'Type',
    'Host',
    'Port',
    'Description',
    'Folder',
    'Username',
    'Password',
    'Domain',
    'IsFavorite',
    'EnableDrive',
    'CreatedAt',
    'UpdatedAt',
  ];

  const rows = connections.map((conn) => {
    let username = '';
    let password = '';
    let domain = '';

    if (includeCredentials && masterKey) {
      if (conn.encryptedUsername && conn.usernameIV && conn.usernameTag) {
        try {
          username = decrypt(
            { ciphertext: conn.encryptedUsername, iv: conn.usernameIV, tag: conn.usernameTag },
            masterKey
          );
        } catch {
          username = '';
        }
      }
      if (conn.encryptedPassword && conn.passwordIV && conn.passwordTag) {
        try {
          password = decrypt(
            { ciphertext: conn.encryptedPassword, iv: conn.passwordIV, tag: conn.passwordTag },
            masterKey
          );
        } catch {
          password = '';
        }
      }
      if (conn.encryptedDomain && conn.domainIV && conn.domainTag) {
        try {
          domain = decrypt(
            { ciphertext: conn.encryptedDomain, iv: conn.domainIV, tag: conn.domainTag },
            masterKey
          );
        } catch {
          domain = '';
        }
      }
    }

    return [
      conn.name,
      conn.type,
      conn.host,
      String(conn.port),
      conn.description || '',
      conn.folderId ? (folderMap.get(conn.folderId) || '') : '',
      username,
      password,
      domain,
      String(conn.isFavorite),
      String(conn.enableDrive),
      conn.createdAt.toISOString(),
      conn.updatedAt.toISOString(),
    ];
  });

  return generateCSV(headers, rows);
}

export async function importConnectionsFromCsv(
  csvData: string,
  columnMapping: ColumnMapping,
  options: ImportOptions
): Promise<ImportResult> {
  const { userId, tenantId, duplicateStrategy } = options;
  const result: ImportResult = { imported: 0, skipped: 0, failed: 0, errors: [] };

  const { parseCSV } = await import('../utils/csvParser');
  const { headers, rows } = parseCSV(csvData);

  const masterKey = getMasterKey(userId);
  if (!masterKey) {
    throw new AppError('Vault is locked. Cannot import connections with credentials.', 403);
  }

  const folderCache = new Map<string, string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowData: Record<string, string> = {};
    headers.forEach((header, index) => {
      rowData[header] = row[index] || '';
    });

    try {
      const name = rowData[columnMapping.name || ''] || '';
      const host = rowData[columnMapping.host || ''] || '';
      const portStr = rowData[columnMapping.port || ''] || '22';
      const typeStr = rowData[columnMapping.type || ''] || 'SSH';
      const username = rowData[columnMapping.username || ''];
      const password = rowData[columnMapping.password || ''];
      const folderName = rowData[columnMapping.folder || ''];
      const description = rowData[columnMapping.description || ''];

      if (!name || !host) {
        result.failed++;
        result.errors.push({ row: i + 2, filename: 'CSV', error: 'Name and host are required' });
        continue;
      }

      const port = parseInt(portStr, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        result.failed++;
        result.errors.push({ row: i + 2, filename: 'CSV', error: 'Invalid port number' });
        continue;
      }

      const type = mapTypeString(typeStr);
      if (!type) {
        result.failed++;
        result.errors.push({ row: i + 2, filename: 'CSV', error: `Invalid connection type: ${typeStr}` });
        continue;
      }

      let folderId: string | undefined;
      if (folderName) {
        if (!folderCache.has(folderName)) {
          const folder = await findOrCreateFolder(userId, folderName);
          folderCache.set(folderName, folder.id);
        }
        folderId = folderCache.get(folderName);
      }

      const exists = await checkDuplicate(userId, host, port, type);
      if (exists && duplicateStrategy === 'SKIP') {
        result.skipped++;
        continue;
      }
      if (exists && duplicateStrategy === 'RENAME') {
        const baseName = name;
        let counter = 1;
        let newName = name;
        while (await checkDuplicateByName(userId, newName)) {
          newName = `${baseName} (${counter})`;
          counter++;
        }
        rowData[columnMapping.name || ''] = newName;
      }

      const input: CreateConnectionInput = {
        name,
        type,
        host,
        port,
        username: username || undefined,
        password: password || undefined,
        description: description || undefined,
        folderId,
      };

      await connectionService.createConnection(userId, input, tenantId);
      result.imported++;
    } catch (err) {
      result.failed++;
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      result.errors.push({ row: i + 2, filename: 'CSV', error: errorMessage });
    }

    if ((i + 1) % BATCH_SIZE === 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return result;
}

export async function importConnectionsFromJson(
  jsonData: unknown,
  options: ImportOptions
): Promise<ImportResult> {
  const { userId, tenantId, duplicateStrategy } = options;
  const result: ImportResult = { imported: 0, skipped: 0, failed: 0, errors: [] };

  const masterKey = getMasterKey(userId);
  if (!masterKey) {
    throw new AppError('Vault is locked. Cannot import connections with credentials.', 403);
  }

  let connectionsToImport: Array<Record<string, unknown>> = [];

  if (Array.isArray(jsonData)) {
    connectionsToImport = jsonData as Array<Record<string, unknown>>;
  } else if (typeof jsonData === 'object' && jsonData !== null && 'connections' in jsonData) {
    const data = jsonData as { connections: unknown };
    if (Array.isArray(data.connections)) {
      connectionsToImport = data.connections as Array<Record<string, unknown>>;
    }
  }

  const folderCache = new Map<string, string>();

  for (let i = 0; i < connectionsToImport.length; i++) {
    const conn = connectionsToImport[i];

    try {
      const name = String(conn.name || '');
      const host = String(conn.host || '');
      const port = Number(conn.port || 22);
      const type = conn.type as ConnectionType;
      const username = conn.username as string | undefined;
      const password = conn.password as string | undefined;
      const folderName = conn.folderName as string | undefined;
      const description = conn.description as string | undefined;

      if (!name || !host) {
        result.failed++;
        result.errors.push({ row: i + 1, filename: 'JSON', error: 'Name and host are required' });
        continue;
      }

      if (!['RDP', 'SSH', 'VNC'].includes(type)) {
        result.failed++;
        result.errors.push({ row: i + 1, filename: 'JSON', error: `Invalid connection type: ${type}` });
        continue;
      }

      let folderId: string | undefined;
      if (folderName) {
        if (!folderCache.has(folderName)) {
          const folder = await findOrCreateFolder(userId, folderName);
          folderCache.set(folderName, folder.id);
        }
        folderId = folderCache.get(folderName);
      }

      const exists = await checkDuplicate(userId, host, port, type);
      if (exists && duplicateStrategy === 'SKIP') {
        result.skipped++;
        continue;
      }
      if (exists && duplicateStrategy === 'RENAME') {
        const baseName = name;
        let counter = 1;
        let newName = name;
        while (await checkDuplicateByName(userId, newName)) {
          newName = `${baseName} (${counter})`;
          counter++;
        }
        conn.name = newName;
      }

      const input: CreateConnectionInput = {
        name,
        type,
        host,
        port,
        username,
        password,
        description,
        folderId,
      };

      await connectionService.createConnection(userId, input, tenantId);
      result.imported++;
    } catch (err) {
      result.failed++;
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      result.errors.push({ row: i + 1, filename: 'JSON', error: errorMessage });
    }

    if ((i + 1) % BATCH_SIZE === 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return result;
}

export async function importConnectionsFromMremoteng(
  xmlData: string,
  options: ImportOptions
): Promise<ImportResult> {
  const { userId, tenantId, duplicateStrategy } = options;
  const result: ImportResult = { imported: 0, skipped: 0, failed: 0, errors: [] };

  const masterKey = getMasterKey(userId);
  if (!masterKey) {
    throw new AppError('Vault is locked. Cannot import connections with credentials.', 403);
  }

  const parsedConnections = parseMremotengXml(xmlData);
  const folderCache = new Map<string, string>();

  for (let i = 0; i < parsedConnections.length; i++) {
    const conn = parsedConnections[i];

    try {
      const type = mapMremotengProtocol(conn.protocol);
      if (!type) {
        result.skipped++;
        continue;
      }

      const port = parseInt(conn.port, 10) || 22;
      const name = conn.name || 'Unnamed';
      const host = conn.hostname;

      if (!host) {
        result.failed++;
        result.errors.push({ row: i + 1, filename: 'mRemoteNG', error: 'Missing hostname' });
        continue;
      }

      let folderId: string | undefined;
      if (conn.panel) {
        if (!folderCache.has(conn.panel)) {
          const folder = await findOrCreateFolder(userId, conn.panel);
          folderCache.set(conn.panel, folder.id);
        }
        folderId = folderCache.get(conn.panel);
      }

      const exists = await checkDuplicate(userId, host, port, type);
      if (exists && duplicateStrategy === 'SKIP') {
        result.skipped++;
        continue;
      }
      if (exists && duplicateStrategy === 'RENAME') {
        const baseName = name;
        let counter = 1;
        let newName = name;
        while (await checkDuplicateByName(userId, newName)) {
          newName = `${baseName} (${counter})`;
          counter++;
        }
        conn.name = newName;
      }

      const input: CreateConnectionInput = {
        name: conn.name,
        type,
        host,
        port,
        username: conn.username,
        password: conn.password,
        description: conn.description,
        folderId,
      };

      await connectionService.createConnection(userId, input, tenantId);
      result.imported++;
    } catch (err) {
      result.failed++;
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      result.errors.push({ row: i + 1, filename: 'mRemoteNG', error: errorMessage });
    }

    if ((i + 1) % BATCH_SIZE === 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return result;
}

export async function importConnectionsFromRdp(
  rdpContent: string,
  options: ImportOptions
): Promise<ImportResult> {
  const { userId, tenantId, duplicateStrategy } = options;
  const result: ImportResult = { imported: 0, skipped: 0, failed: 0, errors: [] };

  const masterKey = getMasterKey(userId);
  if (!masterKey) {
    throw new AppError('Vault is locked. Cannot import connections with credentials.', 403);
  }

  const parsed = parseRdpFile(rdpContent);

  try {
    const exists = await checkDuplicate(userId, parsed.hostname, parsed.port, 'RDP');
    if (exists && duplicateStrategy === 'SKIP') {
      result.skipped++;
      return result;
    }

    const input: CreateConnectionInput = {
      name: parsed.hostname || 'RDP Connection',
      type: 'RDP',
      host: parsed.hostname,
      port: parsed.port,
      username: parsed.username,
    };

    await connectionService.createConnection(userId, input, tenantId);
    result.imported++;
  } catch (err) {
    result.failed++;
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    result.errors.push({ row: 1, filename: 'RDP', error: errorMessage });
  }

  return result;
}

async function findOrCreateFolder(userId: string, name: string): Promise<{ id: string }> {
  const existing = await prisma.folder.findFirst({
    where: {
      userId,
      name,
      parentId: null,
    },
  });

  if (existing) {
    return existing;
  }

  return prisma.folder.create({
    data: {
      name,
      userId,
    },
  });
}

async function checkDuplicate(
  userId: string,
  host: string,
  port: number,
  type: ConnectionType
): Promise<boolean> {
  const existing = await prisma.connection.findFirst({
    where: {
      userId,
      host,
      port,
      type,
    },
  });

  return !!existing;
}

async function checkDuplicateByName(userId: string, name: string): Promise<boolean> {
  const existing = await prisma.connection.findFirst({
    where: {
      userId,
      name,
    },
  });

  return !!existing;
}

function mapTypeString(typeStr: string): ConnectionType | null {
  const normalized = typeStr.toUpperCase().trim();
  switch (normalized) {
    case 'RDP':
      return 'RDP';
    case 'SSH':
    case 'SFTP':
    case 'TELNET':
      return 'SSH';
    case 'VNC':
      return 'VNC';
    default:
      return null;
  }
}
