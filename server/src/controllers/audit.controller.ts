import { Response, NextFunction } from 'express';
import { AuthRequest, assertAuthenticated, assertTenantAuthenticated } from '../types';
import * as auditService from '../services/audit.service';
import * as permissionService from '../services/permission.service';
import { AppError } from '../middleware/error.middleware';
import { AuditAction } from '../lib/prisma';
import type { AuditQueryInput, TenantAuditQueryInput, ConnectionIdInput, ConnectionAuditQueryInput } from '../schemas/audit.schemas';

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const query = req.query as unknown as AuditQueryInput;
    const result = await auditService.getAuditLogs({
      userId: req.user.userId,
      ...query,
      action: query.action as AuditAction | undefined,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function listGateways(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const gateways = await auditService.getAuditGateways(req.user.userId);
    res.json(gateways);
  } catch (err) {
    next(err);
  }
}

export async function listTenantLogs(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertTenantAuthenticated(req);
    const query = req.query as unknown as TenantAuditQueryInput;
    const result = await auditService.getTenantAuditLogs({
      tenantId: req.user.tenantId,
      ...query,
      action: query.action as AuditAction | undefined,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function listConnectionLogs(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertTenantAuthenticated(req);
    const { connectionId } = req.params as unknown as ConnectionIdInput;
    const query = req.query as unknown as ConnectionAuditQueryInput;

    const access = await permissionService.canViewConnection(
      req.user.userId, connectionId, req.user.tenantId
    );
    if (!access.allowed) {
      return next(new AppError('Connection not found', 404));
    }

    const isAdmin = req.user.tenantRole === 'ADMIN' || req.user.tenantRole === 'OWNER';

    const result = await auditService.getConnectionAuditLogs({
      connectionId,
      userId: isAdmin ? query.userId : req.user.userId,
      isAdmin,
      ...query,
      action: query.action as AuditAction | undefined,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function listConnectionAuditUsers(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertTenantAuthenticated(req);
    const { connectionId } = req.params as unknown as ConnectionIdInput;

    const isAdmin = req.user.tenantRole === 'ADMIN' || req.user.tenantRole === 'OWNER';
    if (!isAdmin) {
      return next(new AppError('Forbidden', 403));
    }

    const access = await permissionService.canViewConnection(
      req.user.userId, connectionId, req.user.tenantId
    );
    if (!access.allowed) {
      return next(new AppError('Connection not found', 404));
    }

    const users = await auditService.getConnectionAuditUsers(connectionId);
    res.json(users);
  } catch (err) {
    next(err);
  }
}

export async function listTenantGateways(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertTenantAuthenticated(req);
    const gateways = await auditService.getTenantAuditGateways(req.user.tenantId);
    res.json(gateways);
  } catch (err) {
    next(err);
  }
}

export async function listCountries(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const countries = await auditService.getAuditCountries(req.user.userId);
    res.json(countries);
  } catch (err) {
    next(err);
  }
}

export async function getTenantGeoSummary(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertTenantAuthenticated(req);
    const days = req.query.days ? parseInt(String(req.query.days), 10) : 30;
    if (isNaN(days) || days < 1 || days > 365) {
      return next(new AppError('days must be between 1 and 365', 400));
    }
    const points = await auditService.getTenantGeoSummary(req.user.tenantId, days);
    res.json({ points });
  } catch (err) {
    next(err);
  }
}

export async function listTenantCountries(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertTenantAuthenticated(req);
    const countries = await auditService.getTenantAuditCountries(req.user.tenantId);
    res.json(countries);
  } catch (err) {
    next(err);
  }
}
