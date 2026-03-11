import { Response, NextFunction } from 'express';
import { AuthRequest, assertAuthenticated, assertTenantAuthenticated } from '../types';
import * as userService from '../services/user.service';
import * as domainService from '../services/domain.service';
import * as identityVerification from '../services/identityVerification.service';
import * as auditService from '../services/audit.service';
import { getClientIp } from '../utils/ip';
import type { UpdateProfileInput, ChangePasswordInput, InitiateEmailChangeInput, ConfirmEmailChangeInput, InitiateIdentityInput, ConfirmIdentityInput, UploadAvatarInput, UserSearchInput, UpdateDomainProfileInput } from '../schemas/user.schemas';
import type { SshTerminalConfig, RdpSettings } from '../schemas/common.schemas';

export async function getProfile(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const result = await userService.getProfile(req.user.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function updateProfile(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const data = req.body as UpdateProfileInput;
    const result = await userService.updateProfile(req.user.userId, data);
    auditService.log({
      userId: req.user.userId, action: 'PROFILE_UPDATE',
      details: { fields: Object.keys(data) },
      ipAddress: getClientIp(req),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function changePassword(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { oldPassword, newPassword, verificationId } = req.body as ChangePasswordInput;
    const result = await userService.changePassword(
      req.user.userId, oldPassword, newPassword, verificationId,
    );
    auditService.log({ userId: req.user.userId, action: 'PASSWORD_CHANGE', ipAddress: getClientIp(req) });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function initiateEmailChange(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { newEmail } = req.body as InitiateEmailChangeInput;
    const result = await userService.initiateEmailChange(req.user.userId, newEmail);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function confirmEmailChange(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const data = req.body as ConfirmEmailChangeInput;
    const result = await userService.confirmEmailChange(req.user.userId, data);
    auditService.log({
      userId: req.user.userId, action: 'PROFILE_EMAIL_CHANGE',
      details: { newEmail: result.email },
      ipAddress: getClientIp(req),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function initiatePasswordChange(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const result = await userService.initiatePasswordChange(req.user.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function initiateIdentity(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { purpose } = req.body as InitiateIdentityInput;
    const result = await identityVerification.initiateVerification(req.user.userId, purpose);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function confirmIdentity(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { verificationId, code, credential, password } = req.body as ConfirmIdentityInput;
    const confirmed = await identityVerification.confirmVerification(
      verificationId, req.user.userId,
      { code, credential: credential as never, password },
    );
    res.json({ confirmed });
  } catch (err) {
    next(err);
  }
}

export async function updateSshDefaults(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const data = req.body as SshTerminalConfig;
    const result = await userService.updateSshDefaults(req.user.userId, data);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function updateRdpDefaults(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const data = req.body as RdpSettings;
    const result = await userService.updateRdpDefaults(req.user.userId, data);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function uploadAvatar(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { avatarData } = req.body as UploadAvatarInput;
    const result = await userService.uploadAvatar(req.user.userId, avatarData);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function search(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertTenantAuthenticated(req);
    const { q, scope, teamId } = req.query as UserSearchInput;
    const results = await userService.searchUsers(
      req.user.userId,
      req.user.tenantId,
      q,
      scope,
      teamId
    );
    res.json(results);
  } catch (err) {
    next(err);
  }
}

// --- Domain Profile ---

export async function getDomainProfile(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const result = await domainService.getDomainProfile(req.user.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function updateDomainProfile(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const data = req.body as UpdateDomainProfileInput;
    const result = await domainService.updateDomainProfile(req.user.userId, data);
    auditService.log({
      userId: req.user.userId, action: 'DOMAIN_PROFILE_UPDATE',
      details: { fields: Object.keys(data) },
      ipAddress: getClientIp(req),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function clearDomainProfile(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    await domainService.clearDomainProfile(req.user.userId);
    auditService.log({
      userId: req.user.userId, action: 'DOMAIN_PROFILE_CLEAR',
      ipAddress: getClientIp(req),
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}
