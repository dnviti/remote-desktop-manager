import { Response } from 'express';
import { AuthRequest, assertAuthenticated, assertTenantAuthenticated } from '../types';
import * as userService from '../services/user.service';
import * as domainService from '../services/domain.service';
import * as identityVerification from '../services/identityVerification.service';
import * as notificationService from '../services/notification.service';
import * as auditService from '../services/audit.service';
import { getClientIp } from '../utils/ip';
import type { UpdateProfileInput, ChangePasswordInput, InitiateEmailChangeInput, ConfirmEmailChangeInput, InitiateIdentityInput, ConfirmIdentityInput, UploadAvatarInput, UserSearchInput, UpdateDomainProfileInput, UpdateNotificationScheduleInput } from '../schemas/user.schemas';
import type { SshTerminalConfig, RdpSettings } from '../schemas/common.schemas';

/** Roles allowed to perform tenant-wide user searches. */
const ADMIN_ROLES = new Set(['OWNER', 'ADMIN']);

export async function getProfile(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const result = await userService.getProfile(req.user.userId);
  res.json(result);
}

export async function updateProfile(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const data = req.body as UpdateProfileInput;
  const result = await userService.updateProfile(req.user.userId, data);
  auditService.log({
    userId: req.user.userId, action: 'PROFILE_UPDATE',
    details: { fields: Object.keys(data) },
    ipAddress: getClientIp(req),
  });
  res.json(result);
}

export async function changePassword(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const { oldPassword, newPassword, verificationId } = req.body as ChangePasswordInput;
  const result = await userService.changePassword(
    req.user.userId, oldPassword, newPassword, verificationId,
  );
  auditService.log({ userId: req.user.userId, action: 'PASSWORD_CHANGE', ipAddress: getClientIp(req) });
  auditService.log({ userId: req.user.userId, action: 'VAULT_RECOVERY_KEY_GENERATED', ipAddress: getClientIp(req) });
  res.json(result);
}

export async function initiateEmailChange(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const { newEmail } = req.body as InitiateEmailChangeInput;
  const result = await userService.initiateEmailChange(req.user.userId, newEmail);
  res.json(result);
}

export async function confirmEmailChange(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const data = req.body as ConfirmEmailChangeInput;
  const result = await userService.confirmEmailChange(req.user.userId, data);
  auditService.log({
    userId: req.user.userId, action: 'PROFILE_EMAIL_CHANGE',
    details: { newEmail: result.email },
    ipAddress: getClientIp(req),
  });
  res.json(result);
}

export async function initiatePasswordChange(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const result = await userService.initiatePasswordChange(req.user.userId);
  res.json(result);
}

export async function initiateIdentity(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const { purpose } = req.body as InitiateIdentityInput;
  const result = await identityVerification.initiateVerification(req.user.userId, purpose);
  res.json(result);
}

export async function confirmIdentity(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const { verificationId, code, credential, password } = req.body as ConfirmIdentityInput;
  const confirmed = await identityVerification.confirmVerification(
    verificationId, req.user.userId,
    { code, credential: credential as never, password },
  );
  res.json({ confirmed });
}

export async function updateSshDefaults(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const data = req.body as SshTerminalConfig;
  const result = await userService.updateSshDefaults(req.user.userId, data);
  res.json(result);
}

export async function updateRdpDefaults(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const data = req.body as RdpSettings;
  const result = await userService.updateRdpDefaults(req.user.userId, data);
  res.json(result);
}

export async function uploadAvatar(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const { avatarData } = req.body as UploadAvatarInput;
  const result = await userService.uploadAvatar(req.user.userId, avatarData);
  res.json(result);
}

export async function search(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const { q, scope, teamId } = req.query as UserSearchInput;

  // Only OWNER and ADMIN roles may use tenant-wide search; others fall back to team scope
  const effectiveScope = scope === 'tenant' && !ADMIN_ROLES.has(req.user.tenantRole)
    ? 'team'
    : scope;

  const results = await userService.searchUsers(
    req.user.userId,
    req.user.tenantId,
    q,
    effectiveScope,
    teamId
  );
  res.json(results);
}

// --- Domain Profile ---

export async function getDomainProfile(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const result = await domainService.getDomainProfile(req.user.userId);
  res.json(result);
}

export async function updateDomainProfile(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const data = req.body as UpdateDomainProfileInput;
  const result = await domainService.updateDomainProfile(req.user.userId, data);
  auditService.log({
    userId: req.user.userId, action: 'DOMAIN_PROFILE_UPDATE',
    details: { fields: Object.keys(data) },
    ipAddress: getClientIp(req),
  });
  res.json(result);
}

export async function clearDomainProfile(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  await domainService.clearDomainProfile(req.user.userId);
  auditService.log({
    userId: req.user.userId, action: 'DOMAIN_PROFILE_CLEAR',
    ipAddress: getClientIp(req),
  });
  res.json({ success: true });
}

// --- Notification Schedule (DND / Quiet Hours) ---

export async function getNotificationSchedule(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const schedule = await notificationService.getNotificationSchedule(req.user.userId);
  res.json(schedule);
}

export async function updateNotificationSchedule(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const data = req.body as UpdateNotificationScheduleInput;
  const schedule = await notificationService.updateNotificationSchedule(req.user.userId, data);
  res.json(schedule);
}
