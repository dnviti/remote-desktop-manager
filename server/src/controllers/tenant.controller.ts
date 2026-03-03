import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import * as tenantService from '../services/tenant.service';
import * as auditService from '../services/audit.service';
import * as authService from '../services/auth.service';
import { AppError } from '../middleware/error.middleware';
import prisma from '../lib/prisma';

const createTenantSchema = z.object({
  name: z.string().min(2).max(100),
});

const updateTenantSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  defaultSessionTimeoutSeconds: z.number().int().min(60).max(86400).optional(),
  mfaRequired: z.boolean().optional(),
});

const inviteUserSchema = z.object({
  email: z.string().email(),
  role: z.enum(['ADMIN', 'MEMBER']),
});

const updateRoleSchema = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER']),
});

export async function createTenant(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name } = createTenantSchema.parse(req.body);
    const tenant = await tenantService.createTenant(req.user!.userId, name);

    // Fetch updated user and issue fresh tokens with tenantId embedded
    const updatedUser = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.userId },
      select: { id: true, email: true, username: true, avatarData: true, tenantId: true, tenantRole: true },
    });
    const tokens = await authService.issueTokens(updatedUser);

    auditService.log({
      userId: req.user!.userId, action: 'TENANT_CREATE',
      targetType: 'Tenant', targetId: tenant.id,
      details: { name },
      ipAddress: req.ip,
    });
    res.status(201).json({
      tenant,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: tokens.user,
    });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function getMyTenant(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await tenantService.getTenant(req.user!.tenantId!);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function updateTenant(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = updateTenantSchema.parse(req.body);
    const tenantId = req.params.id as string;
    const result = await tenantService.updateTenant(tenantId, data);
    if (data.mfaRequired !== undefined) {
      auditService.log({
        userId: req.user!.userId, action: 'TENANT_MFA_POLICY_UPDATE',
        targetType: 'Tenant', targetId: tenantId,
        details: { mfaRequired: data.mfaRequired },
        ipAddress: req.ip,
      });
    }
    auditService.log({
      userId: req.user!.userId, action: 'TENANT_UPDATE',
      targetType: 'Tenant', targetId: tenantId,
      details: { fields: Object.keys(data) },
      ipAddress: req.ip,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function deleteTenant(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const tenantId = req.params.id as string;
    const result = await tenantService.deleteTenant(tenantId);
    auditService.log({
      userId: req.user!.userId, action: 'TENANT_DELETE',
      targetType: 'Tenant', targetId: tenantId,
      ipAddress: req.ip,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function listUsers(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await tenantService.listTenantUsers(req.params.id as string);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function inviteUser(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { email, role } = inviteUserSchema.parse(req.body);
    const tenantId = req.params.id as string;
    const result = await tenantService.inviteUser(tenantId, email, role);
    auditService.log({
      userId: req.user!.userId, action: 'TENANT_INVITE_USER',
      targetType: 'Tenant', targetId: tenantId,
      details: { invitedEmail: email, role },
      ipAddress: req.ip,
    });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function updateUserRole(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { role } = updateRoleSchema.parse(req.body);
    const tenantId = req.params.id as string;
    const targetUserId = req.params.userId as string;
    const result = await tenantService.updateUserRole(tenantId, targetUserId, role, req.user!.userId);
    auditService.log({
      userId: req.user!.userId, action: 'TENANT_UPDATE_USER_ROLE',
      targetType: 'User', targetId: targetUserId,
      details: { newRole: role, tenantId },
      ipAddress: req.ip,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function removeUser(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const tenantId = req.params.id as string;
    const targetUserId = req.params.userId as string;
    const result = await tenantService.removeUser(tenantId, targetUserId, req.user!.userId);
    auditService.log({
      userId: req.user!.userId, action: 'TENANT_REMOVE_USER',
      targetType: 'User', targetId: targetUserId,
      details: { tenantId },
      ipAddress: req.ip,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getMfaStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const tenantId = req.params.id as string;
    const stats = await tenantService.getTenantMfaStats(tenantId);
    res.json(stats);
  } catch (err) {
    next(err);
  }
}
