import { Response } from 'express';
import { AuthRequest, assertAuthenticated, assertTenantAuthenticated } from '../types';
import { hasAnyRole } from '../middleware/tenant.middleware';
import * as auditService from '../services/audit.service';
import * as permissionService from '../services/permission.service';
import prisma from '../lib/prisma';
import { AppError } from '../middleware/error.middleware';
import { validatedQuery, validatedParams } from '../middleware/validate.middleware';
import { AuditAction } from '../lib/prisma';
import type { AuditQueryInput, TenantAuditQueryInput, ConnectionIdInput, ConnectionAuditQueryInput } from '../schemas/audit.schemas';

export async function list(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const query = validatedQuery<AuditQueryInput>(req);
  const result = await auditService.getAuditLogs({
    userId: req.user.userId,
    ...query,
    action: query.action as AuditAction | undefined,
  });
  res.json(result);
}

export async function listGateways(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const gateways = await auditService.getAuditGateways(req.user.userId);
  res.json(gateways);
}

export async function listTenantLogs(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const query = validatedQuery<TenantAuditQueryInput>(req);
  const result = await auditService.getTenantAuditLogs({
    tenantId: req.user.tenantId,
    ...query,
    action: query.action as AuditAction | undefined,
  });
  res.json(result);
}

export async function listConnectionLogs(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const { connectionId } = validatedParams<ConnectionIdInput>(req);
  const query = validatedQuery<ConnectionAuditQueryInput>(req);

  const access = await permissionService.canViewConnection(
    req.user.userId, connectionId, req.user.tenantId
  );
  if (!access.allowed) {
    throw new AppError('Connection not found', 404);
  }

  const isAdmin = hasAnyRole(req.user.tenantRole, 'ADMIN', 'OWNER', 'AUDITOR');

  const result = await auditService.getConnectionAuditLogs({
    connectionId,
    userId: isAdmin ? query.userId : req.user.userId,
    isAdmin,
    ...query,
    action: query.action as AuditAction | undefined,
  });
  res.json(result);
}

export async function listConnectionAuditUsers(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const { connectionId } = validatedParams<ConnectionIdInput>(req);

  const isAdmin = hasAnyRole(req.user.tenantRole, 'ADMIN', 'OWNER', 'AUDITOR');
  if (!isAdmin) {
    throw new AppError('Forbidden', 403);
  }

  const access = await permissionService.canViewConnection(
    req.user.userId, connectionId, req.user.tenantId
  );
  if (!access.allowed) {
    throw new AppError('Connection not found', 404);
  }

  const users = await auditService.getConnectionAuditUsers(connectionId);
  res.json(users);
}

export async function listTenantGateways(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const gateways = await auditService.getTenantAuditGateways(req.user.tenantId);
  res.json(gateways);
}

export async function listCountries(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const countries = await auditService.getAuditCountries(req.user.userId);
  res.json(countries);
}

export async function getTenantGeoSummary(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const days = req.query.days ? parseInt(String(req.query.days), 10) : 30;
  if (isNaN(days) || days < 1 || days > 365) {
    throw new AppError('days must be between 1 and 365', 400);
  }
  const points = await auditService.getTenantGeoSummary(req.user.tenantId, days);
  res.json({ points });
}

export async function listTenantCountries(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const countries = await auditService.getTenantAuditCountries(req.user.tenantId);
  res.json(countries);
}

export async function getSessionRecording(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const sessionId = req.params.sessionId as string;

  const recording = await prisma.sessionRecording.findFirst({
    where: { sessionId },
    include: {
      connection: { select: { id: true, name: true, type: true, host: true, port: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!recording) throw new AppError('Recording not found', 404);

  // Verify the user owns the recording or is a tenant admin/auditor
  const isOwner = recording.userId === req.user.userId;
  const isAuditor = Boolean(req.user.tenantId) && hasAnyRole(req.user.tenantRole, 'ADMIN', 'OWNER', 'AUDITOR');

  if (!isOwner && !isAuditor) {
    throw new AppError('Recording not found', 404);
  }

  res.json(recording);
}
