import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import prisma from '../lib/prisma';
import * as secretService from '../services/secret.service';
import * as secretSharingService from '../services/secretSharing.service';
import * as auditService from '../services/audit.service';
import { AppError } from '../middleware/error.middleware';

// --- Zod schemas ---

const loginDataSchema = z.object({
  type: z.literal('LOGIN'),
  username: z.string().min(1),
  password: z.string().min(1),
  url: z.string().optional(),
  notes: z.string().optional(),
});

const sshKeyDataSchema = z.object({
  type: z.literal('SSH_KEY'),
  username: z.string().optional(),
  privateKey: z.string().min(1),
  publicKey: z.string().optional(),
  passphrase: z.string().optional(),
  algorithm: z.string().optional(),
  notes: z.string().optional(),
});

const certificateDataSchema = z.object({
  type: z.literal('CERTIFICATE'),
  certificate: z.string().min(1),
  privateKey: z.string().min(1),
  chain: z.string().optional(),
  passphrase: z.string().optional(),
  expiresAt: z.string().optional(),
  notes: z.string().optional(),
});

const apiKeyDataSchema = z.object({
  type: z.literal('API_KEY'),
  apiKey: z.string().min(1),
  endpoint: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  notes: z.string().optional(),
});

const secureNoteDataSchema = z.object({
  type: z.literal('SECURE_NOTE'),
  content: z.string().min(1),
});

const secretDataSchema = z.discriminatedUnion('type', [
  loginDataSchema,
  sshKeyDataSchema,
  certificateDataSchema,
  apiKeyDataSchema,
  secureNoteDataSchema,
]);

const createSecretSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    type: z.enum(['LOGIN', 'SSH_KEY', 'CERTIFICATE', 'API_KEY', 'SECURE_NOTE']),
    scope: z.enum(['PERSONAL', 'TEAM', 'TENANT']),
    teamId: z.string().uuid().optional(),
    folderId: z.string().uuid().optional(),
    data: secretDataSchema,
    metadata: z.record(z.string(), z.unknown()).optional(),
    tags: z.array(z.string()).optional(),
    expiresAt: z.string().datetime().optional(),
  })
  .refine((data) => data.scope !== 'TEAM' || !!data.teamId, {
    message: 'teamId is required for team-scoped secrets',
    path: ['teamId'],
  });

const updateSecretSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  data: secretDataSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  tags: z.array(z.string()).optional(),
  folderId: z.string().uuid().nullable().optional(),
  isFavorite: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  changeNote: z.string().optional(),
});

const listFiltersSchema = z.object({
  scope: z.enum(['PERSONAL', 'TEAM', 'TENANT']).optional(),
  type: z.enum(['LOGIN', 'SSH_KEY', 'CERTIFICATE', 'API_KEY', 'SECURE_NOTE']).optional(),
  teamId: z.string().uuid().optional(),
  folderId: z.string().uuid().nullable().optional(),
  search: z.string().optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional(),
  isFavorite: z.enum(['true', 'false']).optional(),
});

const shareSecretSchema = z
  .object({
    email: z.string().email().optional(),
    userId: z.string().optional(),
    permission: z.enum(['READ_ONLY', 'FULL_ACCESS']),
  })
  .refine((data) => data.email || data.userId, {
    message: 'Either email or userId is required',
  });

const updateSharePermSchema = z.object({
  permission: z.enum(['READ_ONLY', 'FULL_ACCESS']),
});

const distributeTenantKeySchema = z.object({
  targetUserId: z.string().uuid(),
});

// --- CRUD handlers ---

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = createSecretSchema.parse(req.body);
    const result = await secretService.createSecret(
      req.user!.userId,
      {
        ...data,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      },
      req.user!.tenantId
    );

    auditService.log({
      userId: req.user!.userId,
      action: 'SECRET_CREATE',
      targetType: 'VaultSecret',
      targetId: result.id,
      details: { name: data.name, type: data.type, scope: data.scope },
      ipAddress: req.ip,
    });

    res.status(201).json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filters = listFiltersSchema.parse(req.query);
    const parsedFilters: secretService.SecretListFilters = {
      scope: filters.scope,
      type: filters.type,
      teamId: filters.teamId,
      folderId: filters.folderId,
      search: filters.search,
      tags: filters.tags
        ? Array.isArray(filters.tags)
          ? filters.tags
          : [filters.tags]
        : undefined,
      isFavorite:
        filters.isFavorite === 'true' ? true : filters.isFavorite === 'false' ? false : undefined,
    };
    const result = await secretService.listSecrets(req.user!.userId, parsedFilters, req.user!.tenantId);
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function getOne(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await secretService.getSecret(req.user!.userId, req.params.id as string, req.user!.tenantId);

    auditService.log({
      userId: req.user!.userId,
      action: 'SECRET_READ',
      targetType: 'VaultSecret',
      targetId: req.params.id as string,
      ipAddress: req.ip,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = updateSecretSchema.parse(req.body);
    const result = await secretService.updateSecret(
      req.user!.userId,
      req.params.id as string,
      {
        ...data,
        expiresAt: data.expiresAt === null ? null : data.expiresAt ? new Date(data.expiresAt) : undefined,
      },
      req.user!.tenantId
    );

    auditService.log({
      userId: req.user!.userId,
      action: 'SECRET_UPDATE',
      targetType: 'VaultSecret',
      targetId: req.params.id as string,
      details: { fields: Object.keys(data) },
      ipAddress: req.ip,
    });

    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await secretService.deleteSecret(req.user!.userId, req.params.id as string, req.user!.tenantId);

    auditService.log({
      userId: req.user!.userId,
      action: 'SECRET_DELETE',
      targetType: 'VaultSecret',
      targetId: req.params.id as string,
      ipAddress: req.ip,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

// --- Version handlers ---

export async function listVersions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await secretService.listSecretVersions(
      req.user!.userId,
      req.params.id as string,
      req.user!.tenantId
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function restoreVersion(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const version = parseInt(req.params.version as string, 10);
    if (isNaN(version) || version < 1) {
      return next(new AppError('Invalid version number', 400));
    }
    const result = await secretService.restoreSecretVersion(
      req.user!.userId,
      req.params.id as string,
      version,
      req.user!.tenantId
    );

    auditService.log({
      userId: req.user!.userId,
      action: 'SECRET_VERSION_RESTORE',
      targetType: 'VaultSecret',
      targetId: req.params.id as string,
      details: { restoredVersion: version },
      ipAddress: req.ip,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getVersionData(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const version = parseInt(req.params.version as string, 10);
    if (isNaN(version) || version < 1) {
      return next(new AppError('Invalid version number', 400));
    }
    const result = await secretService.getSecretVersionData(
      req.user!.userId,
      req.params.id as string,
      version,
      req.user!.tenantId
    );

    auditService.log({
      userId: req.user!.userId,
      action: 'SECRET_READ',
      targetType: 'VaultSecret',
      targetId: req.params.id as string,
      details: { version },
      ipAddress: req.ip,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

// --- Sharing handlers ---

export async function share(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { email, userId, permission } = shareSecretSchema.parse(req.body);
    const result = await secretSharingService.shareSecret(
      req.user!.userId,
      req.params.id as string,
      { email, userId },
      permission,
      req.user!.tenantId
    );

    auditService.log({
      userId: req.user!.userId,
      action: 'SECRET_SHARE',
      targetType: 'VaultSecret',
      targetId: req.params.id as string,
      details: { sharedWith: userId || email, permission },
      ipAddress: req.ip,
    });

    res.status(201).json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function unshare(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await secretSharingService.unshareSecret(
      req.user!.userId,
      req.params.id as string,
      req.params.userId as string,
      req.user!.tenantId
    );

    auditService.log({
      userId: req.user!.userId,
      action: 'SECRET_UNSHARE',
      targetType: 'VaultSecret',
      targetId: req.params.id as string,
      details: { targetUserId: req.params.userId as string },
      ipAddress: req.ip,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function updateSharePermission(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { permission } = updateSharePermSchema.parse(req.body);
    const result = await secretSharingService.updateSecretSharePermission(
      req.user!.userId,
      req.params.id as string,
      req.params.userId as string,
      permission,
      req.user!.tenantId
    );

    auditService.log({
      userId: req.user!.userId,
      action: 'SECRET_SHARE_UPDATE',
      targetType: 'VaultSecret',
      targetId: req.params.id as string,
      details: { targetUserId: req.params.userId as string, permission },
      ipAddress: req.ip,
    });

    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function listShares(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await secretSharingService.listSecretShares(
      req.user!.userId,
      req.params.id as string,
      req.user!.tenantId
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// --- Tenant vault handlers ---

export async function initTenantVault(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user!.tenantId) return next(new AppError('Tenant context required', 400));
    if (req.user!.tenantRole !== 'OWNER' && req.user!.tenantRole !== 'ADMIN') {
      return next(new AppError('Only admins and owners can initialize the tenant vault', 403));
    }

    await secretService.initTenantVault(req.user!.tenantId, req.user!.userId);

    auditService.log({
      userId: req.user!.userId,
      action: 'TENANT_VAULT_INIT',
      targetType: 'Tenant',
      targetId: req.user!.tenantId,
      ipAddress: req.ip,
    });

    res.json({ initialized: true });
  } catch (err) {
    next(err);
  }
}

export async function distributeTenantKey(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user!.tenantId) return next(new AppError('Tenant context required', 400));
    if (req.user!.tenantRole !== 'OWNER' && req.user!.tenantRole !== 'ADMIN') {
      return next(new AppError('Only admins and owners can distribute tenant vault keys', 403));
    }

    const { targetUserId } = distributeTenantKeySchema.parse(req.body);
    await secretService.distributeTenantKeyToUser(
      req.user!.tenantId,
      targetUserId,
      req.user!.userId
    );

    auditService.log({
      userId: req.user!.userId,
      action: 'TENANT_VAULT_KEY_DISTRIBUTE',
      targetType: 'User',
      targetId: targetUserId,
      details: { tenantId: req.user!.tenantId },
      ipAddress: req.ip,
    });

    res.json({ distributed: true });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function tenantVaultStatus(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user!.tenantId) return next(new AppError('Tenant context required', 400));

    const tenant = await prisma.tenant.findUnique({
      where: { id: req.user!.tenantId },
      select: { hasTenantVaultKey: true },
    });
    const membership = await prisma.tenantVaultMember.findUnique({
      where: {
        tenantId_userId: {
          tenantId: req.user!.tenantId,
          userId: req.user!.userId,
        },
      },
    });

    res.json({
      initialized: tenant?.hasTenantVaultKey ?? false,
      hasAccess: !!membership,
    });
  } catch (err) {
    next(err);
  }
}
