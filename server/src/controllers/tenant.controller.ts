import { Response } from 'express';
import { AuthRequest, assertAuthenticated, assertTenantAuthenticated } from '../types';
import * as tenantService from '../services/tenant.service';
import * as auditService from '../services/audit.service';
import * as authService from '../services/auth.service';
import prisma from '../lib/prisma';
import { setRefreshTokenCookie, setCsrfCookie } from '../utils/cookie';
import { logger } from '../utils/logger';
import { getClientIp } from '../utils/ip';
import { getRequestBinding } from '../utils/tokenBinding';
import type { CreateTenantInput, UpdateTenantInput, InviteUserInput, UpdateRoleInput, CreateUserInput, ToggleUserEnabledInput, AdminChangeEmailInput, AdminChangePasswordInput, UpdateMembershipExpiryInput } from '../schemas/tenant.schemas';

export async function createTenant(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const { name } = req.body as CreateTenantInput;
  const tenant = await tenantService.createTenant(req.user.userId, name);

  // Issue fresh tokens — issueTokens resolves tenantId from active TenantMember
  const updatedUser = await prisma.user.findUniqueOrThrow({
    where: { id: req.user.userId },
    select: { id: true, email: true, username: true, avatarData: true },
  });
  const tokens = await authService.issueTokens(updatedUser, undefined, getRequestBinding(req));

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
}

export async function getMyTenant(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const result = await tenantService.getTenant(req.user.tenantId);
  res.json(result);
}

export async function updateTenant(req: AuthRequest, res: Response) {
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
  const dlpFields = ['dlpDisableCopy', 'dlpDisablePaste', 'dlpDisableDownload', 'dlpDisableUpload'] as const;
  const dlpChanges = dlpFields.filter((f) => data[f] !== undefined);
  if (dlpChanges.length > 0) {
    auditService.log({
      userId: req.user.userId, action: 'TENANT_DLP_POLICY_UPDATE',
      targetType: 'Tenant', targetId: tenantId,
      details: Object.fromEntries(dlpChanges.map((f) => [f, data[f]])),
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
}

export async function deleteTenant(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const tenantId = req.params.id as string;
  const result = await tenantService.deleteTenant(tenantId);
  auditService.log({
    userId: req.user.userId, action: 'TENANT_DELETE',
    targetType: 'Tenant', targetId: tenantId,
    ipAddress: getClientIp(req),
  });
  res.json(result);
}

export async function listUsers(req: AuthRequest, res: Response) {
  const result = await tenantService.listTenantUsers(req.params.id as string);
  res.json(result);
}

export async function getUserProfile(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const userId = req.params.userId as string;
  const result = await tenantService.getUserProfile(
    req.params.id as string,
    userId,
    req.user.tenantRole,
  );
  res.json(result);
}

export async function inviteUser(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const { email, role, expiresAt } = req.body as InviteUserInput;
  const tenantId = req.params.id as string;
  const result = await tenantService.inviteUser(tenantId, email, role, expiresAt ? new Date(expiresAt) : undefined);
  auditService.log({
    userId: req.user.userId, action: 'TENANT_INVITE_USER',
    targetType: 'Tenant', targetId: tenantId,
    details: { invitedEmail: email, role, expiresAt: expiresAt ?? null },
    ipAddress: getClientIp(req),
  });
  res.status(201).json(result);
}

export async function updateUserRole(req: AuthRequest, res: Response) {
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
}

export async function removeUser(req: AuthRequest, res: Response) {
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
}

export async function getMfaStats(req: AuthRequest, res: Response) {
  const tenantId = req.params.id as string;
  const stats = await tenantService.getTenantMfaStats(tenantId);
  res.json(stats);
}

export async function createUser(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const data = req.body as CreateUserInput;
  const tenantId = req.params.id as string;
  const result = await tenantService.createUser(
    tenantId,
    { email: data.email, username: data.username, password: data.password, role: data.role, expiresAt: data.expiresAt ?? undefined },
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
}

export async function toggleUserEnabled(req: AuthRequest, res: Response) {
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
}

export async function listMyTenants(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const result = await tenantService.listUserTenants(req.user.userId);
  res.json(result);
}

export async function adminChangeUserEmail(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const { newEmail, verificationId } = req.body as AdminChangeEmailInput;
  const tenantId = req.params.id as string;
  const targetUserId = req.params.userId as string;
  const result = await tenantService.adminChangeUserEmail(
    tenantId, req.user.userId, targetUserId, newEmail, verificationId,
  );
  res.json(result);
}

export async function adminChangeUserPassword(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const { newPassword, verificationId } = req.body as AdminChangePasswordInput;
  const tenantId = req.params.id as string;
  const targetUserId = req.params.userId as string;
  const result = await tenantService.adminChangeUserPassword(
    tenantId, req.user.userId, targetUserId, newPassword, verificationId,
  );
  res.json(result);
}

export async function updateMembershipExpiry(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const { expiresAt } = req.body as UpdateMembershipExpiryInput;
  const tenantId = req.params.id as string;
  const targetUserId = req.params.userId as string;
  const result = await tenantService.updateMembershipExpiry(
    tenantId, targetUserId, expiresAt ? new Date(expiresAt) : null,
  );
  auditService.log({
    userId: req.user.userId,
    action: 'TENANT_MEMBERSHIP_EXPIRY_UPDATE',
    targetType: 'TenantMember',
    targetId: targetUserId,
    details: { tenantId, expiresAt: expiresAt ?? null },
    ipAddress: getClientIp(req),
  });
  res.json(result);
}
