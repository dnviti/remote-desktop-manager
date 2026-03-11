import { Response, NextFunction } from 'express';
import { AuthRequest, assertAuthenticated } from '../types';
import prisma from '../lib/prisma';
import * as secretService from '../services/secret.service';
import * as secretSharingService from '../services/secretSharing.service';
import * as auditService from '../services/audit.service';
import { AppError } from '../middleware/error.middleware';
import { getClientIp } from '../utils/ip';
import type { CreateSecretInput, UpdateSecretInput, ListFiltersInput, ShareSecretInput, UpdateSharePermInput, DistributeTenantKeyInput } from '../schemas/secret.schemas';

// --- CRUD handlers ---

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const data = req.body as CreateSecretInput;
    const result = await secretService.createSecret(
      req.user.userId,
      {
        ...data,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      },
      req.user.tenantId
    );

    auditService.log({
      userId: req.user.userId,
      action: 'SECRET_CREATE',
      targetType: 'VaultSecret',
      targetId: result.id,
      details: { name: data.name, type: data.type, scope: data.scope },
      ipAddress: getClientIp(req),
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const filters = req.query as unknown as ListFiltersInput;
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
    const result = await secretService.listSecrets(req.user.userId, parsedFilters, req.user.tenantId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getOne(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const result = await secretService.getSecret(req.user.userId, req.params.id as string, req.user.tenantId);

    auditService.log({
      userId: req.user.userId,
      action: 'SECRET_READ',
      targetType: 'VaultSecret',
      targetId: req.params.id as string,
      ipAddress: getClientIp(req),
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const data = req.body as UpdateSecretInput;
    const result = await secretService.updateSecret(
      req.user.userId,
      req.params.id as string,
      {
        ...data,
        expiresAt: data.expiresAt === null ? null : data.expiresAt ? new Date(data.expiresAt) : undefined,
      },
      req.user.tenantId
    );

    auditService.log({
      userId: req.user.userId,
      action: 'SECRET_UPDATE',
      targetType: 'VaultSecret',
      targetId: req.params.id as string,
      details: { fields: Object.keys(data) },
      ipAddress: getClientIp(req),
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const result = await secretService.deleteSecret(req.user.userId, req.params.id as string, req.user.tenantId);

    auditService.log({
      userId: req.user.userId,
      action: 'SECRET_DELETE',
      targetType: 'VaultSecret',
      targetId: req.params.id as string,
      ipAddress: getClientIp(req),
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

// --- Version handlers ---

export async function listVersions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const result = await secretService.listSecretVersions(
      req.user.userId,
      req.params.id as string,
      req.user.tenantId
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function restoreVersion(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const version = parseInt(req.params.version as string, 10);
    if (isNaN(version) || version < 1) {
      return next(new AppError('Invalid version number', 400));
    }
    const result = await secretService.restoreSecretVersion(
      req.user.userId,
      req.params.id as string,
      version,
      req.user.tenantId
    );

    auditService.log({
      userId: req.user.userId,
      action: 'SECRET_VERSION_RESTORE',
      targetType: 'VaultSecret',
      targetId: req.params.id as string,
      details: { restoredVersion: version },
      ipAddress: getClientIp(req),
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getVersionData(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const version = parseInt(req.params.version as string, 10);
    if (isNaN(version) || version < 1) {
      return next(new AppError('Invalid version number', 400));
    }
    const result = await secretService.getSecretVersionData(
      req.user.userId,
      req.params.id as string,
      version,
      req.user.tenantId
    );

    auditService.log({
      userId: req.user.userId,
      action: 'SECRET_READ',
      targetType: 'VaultSecret',
      targetId: req.params.id as string,
      details: { version },
      ipAddress: getClientIp(req),
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

// --- Sharing handlers ---

export async function share(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { email, userId, permission } = req.body as ShareSecretInput;
    const result = await secretSharingService.shareSecret(
      req.user.userId,
      req.params.id as string,
      { email, userId },
      permission,
      req.user.tenantId
    );

    auditService.log({
      userId: req.user.userId,
      action: 'SECRET_SHARE',
      targetType: 'VaultSecret',
      targetId: req.params.id as string,
      details: { sharedWith: userId || email, permission },
      ipAddress: getClientIp(req),
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function unshare(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const result = await secretSharingService.unshareSecret(
      req.user.userId,
      req.params.id as string,
      req.params.userId as string,
      req.user.tenantId
    );

    auditService.log({
      userId: req.user.userId,
      action: 'SECRET_UNSHARE',
      targetType: 'VaultSecret',
      targetId: req.params.id as string,
      details: { targetUserId: req.params.userId as string },
      ipAddress: getClientIp(req),
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function updateSharePermission(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { permission } = req.body as UpdateSharePermInput;
    const result = await secretSharingService.updateSecretSharePermission(
      req.user.userId,
      req.params.id as string,
      req.params.userId as string,
      permission,
      req.user.tenantId
    );

    auditService.log({
      userId: req.user.userId,
      action: 'SECRET_SHARE_UPDATE',
      targetType: 'VaultSecret',
      targetId: req.params.id as string,
      details: { targetUserId: req.params.userId as string, permission },
      ipAddress: getClientIp(req),
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function listShares(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const result = await secretSharingService.listSecretShares(
      req.user.userId,
      req.params.id as string,
      req.user.tenantId
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// --- Tenant vault handlers ---

export async function initTenantVault(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    if (!req.user.tenantId) return next(new AppError('Tenant context required', 400));
    if (req.user.tenantRole !== 'OWNER' && req.user.tenantRole !== 'ADMIN') {
      return next(new AppError('Only admins and owners can initialize the tenant vault', 403));
    }

    await secretService.initTenantVault(req.user.tenantId, req.user.userId);

    auditService.log({
      userId: req.user.userId,
      action: 'TENANT_VAULT_INIT',
      targetType: 'Tenant',
      targetId: req.user.tenantId,
      ipAddress: getClientIp(req),
    });

    res.json({ initialized: true });
  } catch (err) {
    next(err);
  }
}

export async function distributeTenantKey(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    if (!req.user.tenantId) return next(new AppError('Tenant context required', 400));
    if (req.user.tenantRole !== 'OWNER' && req.user.tenantRole !== 'ADMIN') {
      return next(new AppError('Only admins and owners can distribute tenant vault keys', 403));
    }

    const { targetUserId } = req.body as DistributeTenantKeyInput;
    await secretService.distributeTenantKeyToUser(
      req.user.tenantId,
      targetUserId,
      req.user.userId
    );

    auditService.log({
      userId: req.user.userId,
      action: 'TENANT_VAULT_KEY_DISTRIBUTE',
      targetType: 'User',
      targetId: targetUserId,
      details: { tenantId: req.user.tenantId },
      ipAddress: getClientIp(req),
    });

    res.json({ distributed: true });
  } catch (err) {
    next(err);
  }
}

export async function tenantVaultStatus(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    if (!req.user.tenantId) return next(new AppError('Tenant context required', 400));

    const tenant = await prisma.tenant.findUnique({
      where: { id: req.user.tenantId },
      select: { hasTenantVaultKey: true },
    });
    const membership = await prisma.tenantVaultMember.findUnique({
      where: {
        tenantId_userId: {
          tenantId: req.user.tenantId,
          userId: req.user.userId,
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
