import { Response, NextFunction } from 'express';
import { AuthRequest, assertAuthenticated, assertTenantAuthenticated } from '../types';
import * as tenantService from '../services/tenant.service';
import * as auditService from '../services/audit.service';
import * as authService from '../services/auth.service';
import prisma from '../lib/prisma';
import { setRefreshTokenCookie, setCsrfCookie } from '../utils/cookie';
import { logger } from '../utils/logger';
import { getClientIp } from '../utils/ip';
import type { CreateTenantInput, UpdateTenantInput, InviteUserInput, UpdateRoleInput, CreateUserInput, ToggleUserEnabledInput, AdminChangeEmailInput, AdminChangePasswordInput } from '../schemas/tenant.schemas';

export async function createTenant(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { name } = req.body as CreateTenantInput;
    const tenant = await tenantService.createTenant(req.user.userId, name);

    // Issue fresh tokens — issueTokens resolves tenantId from active TenantMember
    const updatedUser = await prisma.user.findUniqueOrThrow({
      where: { id: req.user.userId },
      select: { id: true, email: true, username: true, avatarData: true },
    });
    const tokens = await authService.issueTokens(updatedUser);

    auditService.log({
      userId: req.user.userId, action: 'TENANT_CREATE',
      targetType: 'Tenant', targetId: tenant.id,
      details: { name },
      ipAddress: getClientIp(req),
    });
    setRefreshTokenCookie(res, tokens.refreshToken);
    const csrfToken = setCsrfCookie(res);
    res.status(201).json({
      tenant,
      accessToken: tokens.accessToken,
      csrfToken,
      user: tokens.user,
    });
  } catch (err) {
    next(err);
  }
}

export async function getMyTenant(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertTenantAuthenticated(req);
    const result = await tenantService.getTenant(req.user.tenantId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function updateTenant(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const data = req.body as UpdateTenantInput;
    const tenantId = req.params.id as string;
    const result = await tenantService.updateTenant(tenantId, data);
    if (data.mfaRequired !== undefined) {
      auditService.log({
        userId: req.user.userId, action: 'TENANT_MFA_POLICY_UPDATE',
        targetType: 'Tenant', targetId: tenantId,
        details: { mfaRequired: data.mfaRequired },
        ipAddress: getClientIp(req),
      });
    }
    auditService.log({
      userId: req.user.userId, action: 'TENANT_UPDATE',
      targetType: 'Tenant', targetId: tenantId,
      details: { fields: Object.keys(data) },
      ipAddress: getClientIp(req),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function deleteTenant(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const tenantId = req.params.id as string;
    const result = await tenantService.deleteTenant(tenantId);
    auditService.log({
      userId: req.user.userId, action: 'TENANT_DELETE',
      targetType: 'Tenant', targetId: tenantId,
      ipAddress: getClientIp(req),
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

export async function getUserProfile(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertTenantAuthenticated(req);
    const userId = req.params.userId as string;
    const result = await tenantService.getUserProfile(
      req.params.id as string,
      userId,
      req.user.tenantRole,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function inviteUser(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { email, role } = req.body as InviteUserInput;
    const tenantId = req.params.id as string;
    const result = await tenantService.inviteUser(tenantId, email, role);
    auditService.log({
      userId: req.user.userId, action: 'TENANT_INVITE_USER',
      targetType: 'Tenant', targetId: tenantId,
      details: { invitedEmail: email, role },
      ipAddress: getClientIp(req),
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function updateUserRole(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { role } = req.body as UpdateRoleInput;
    const tenantId = req.params.id as string;
    const targetUserId = req.params.userId as string;
    const result = await tenantService.updateUserRole(tenantId, targetUserId, role, req.user.userId);
    auditService.log({
      userId: req.user.userId, action: 'TENANT_UPDATE_USER_ROLE',
      targetType: 'User', targetId: targetUserId,
      details: { newRole: role, tenantId },
      ipAddress: getClientIp(req),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function removeUser(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const tenantId = req.params.id as string;
    const targetUserId = req.params.userId as string;
    const result = await tenantService.removeUser(tenantId, targetUserId, req.user.userId);
    auditService.log({
      userId: req.user.userId, action: 'TENANT_REMOVE_USER',
      targetType: 'User', targetId: targetUserId,
      details: { tenantId },
      ipAddress: getClientIp(req),
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

export async function createUser(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const data = req.body as CreateUserInput;
    const tenantId = req.params.id as string;
    const result = await tenantService.createUser(
      tenantId,
      { email: data.email, username: data.username, password: data.password, role: data.role },
      req.user.userId,
    );

    if (data.sendWelcomeEmail) {
      import('../services/email').then(({ sendWelcomeEmail }) => {
        sendWelcomeEmail(data.email, data.password).catch((err: unknown) => {
          logger.error('Failed to send welcome email:', err);
        });
      });
    }

    auditService.log({
      userId: req.user.userId,
      action: 'TENANT_CREATE_USER',
      targetType: 'User',
      targetId: result.user.id,
      details: { email: data.email, role: data.role, tenantId },
      ipAddress: getClientIp(req),
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function toggleUserEnabled(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { enabled } = req.body as ToggleUserEnabledInput;
    const tenantId = req.params.id as string;
    const targetUserId = req.params.userId as string;
    const result = await tenantService.toggleUserEnabled(tenantId, targetUserId, enabled, req.user.userId);

    auditService.log({
      userId: req.user.userId,
      action: 'TENANT_TOGGLE_USER',
      targetType: 'User',
      targetId: targetUserId,
      details: { enabled, tenantId },
      ipAddress: getClientIp(req),
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function listMyTenants(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const result = await tenantService.listUserTenants(req.user.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function adminChangeUserEmail(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { newEmail, verificationId } = req.body as AdminChangeEmailInput;
    const tenantId = req.params.id as string;
    const targetUserId = req.params.userId as string;
    const result = await tenantService.adminChangeUserEmail(
      tenantId, req.user.userId, targetUserId, newEmail, verificationId,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function adminChangeUserPassword(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { newPassword, verificationId } = req.body as AdminChangePasswordInput;
    const tenantId = req.params.id as string;
    const targetUserId = req.params.userId as string;
    const result = await tenantService.adminChangeUserPassword(
      tenantId, req.user.userId, targetUserId, newPassword, verificationId,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}
