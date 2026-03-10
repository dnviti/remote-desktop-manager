import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest, assertAuthenticated, assertTenantAuthenticated } from '../types';
import * as userService from '../services/user.service';
import * as domainService from '../services/domain.service';
import * as identityVerification from '../services/identityVerification.service';
import * as auditService from '../services/audit.service';
import { AppError } from '../middleware/error.middleware';
import { passwordSchema } from '../utils/validate';
import { getClientIp } from '../utils/ip';

const updateProfileSchema = z.object({
  username: z.string().min(1).max(50).optional(),
});

const changePasswordSchema = z.object({
  oldPassword: z.string().optional().default(''),
  newPassword: passwordSchema,
  verificationId: z.string().uuid().optional(),
});

const initiateEmailChangeSchema = z.object({
  newEmail: z.string().email(),
});

const confirmEmailChangeSchema = z.object({
  codeOld: z.string().length(6).optional(),
  codeNew: z.string().length(6).optional(),
  verificationId: z.string().uuid().optional(),
}).refine(
  (d) => (d.codeOld && d.codeNew) || d.verificationId,
  { message: 'Provide either both OTP codes or a verificationId' },
);

const initiateIdentitySchema = z.object({
  purpose: z.enum(['email-change', 'password-change', 'admin-action']),
});

const confirmIdentitySchema = z.object({
  verificationId: z.string().uuid(),
  code: z.string().optional(),
  credential: z.record(z.string(), z.unknown()).optional(),
  password: z.string().optional(),
});

const sshDefaultsSchema = z.object({
  fontFamily: z.string().optional(),
  fontSize: z.number().int().min(10).max(24).optional(),
  lineHeight: z.number().min(1.0).max(2.0).optional(),
  letterSpacing: z.number().min(0).max(5).optional(),
  cursorStyle: z.enum(['block', 'underline', 'bar']).optional(),
  cursorBlink: z.boolean().optional(),
  theme: z.string().optional(),
  customColors: z.record(z.string(), z.string()).optional(),
  scrollback: z.number().int().min(100).max(10000).optional(),
  bellStyle: z.enum(['none', 'sound', 'visual']).optional(),
  syncThemeWithWebUI: z.boolean().optional(),
  syncLightTheme: z.string().optional(),
  syncDarkTheme: z.string().optional(),
});

const rdpDefaultsSchema = z.object({
  colorDepth: z.union([z.literal(8), z.literal(16), z.literal(24)]).optional(),
  width: z.number().int().min(640).max(7680).optional(),
  height: z.number().int().min(480).max(4320).optional(),
  dpi: z.number().int().min(48).max(384).optional(),
  resizeMethod: z.enum(['display-update', 'reconnect']).optional(),
  qualityPreset: z.enum(['performance', 'balanced', 'quality', 'custom']).optional(),
  enableWallpaper: z.boolean().optional(),
  enableTheming: z.boolean().optional(),
  enableFontSmoothing: z.boolean().optional(),
  enableFullWindowDrag: z.boolean().optional(),
  enableDesktopComposition: z.boolean().optional(),
  enableMenuAnimations: z.boolean().optional(),
  forceLossless: z.boolean().optional(),
  disableAudio: z.boolean().optional(),
  enableAudioInput: z.boolean().optional(),
  security: z.enum(['any', 'nla', 'nla-ext', 'tls', 'rdp']).optional(),
  ignoreCert: z.boolean().optional(),
  serverLayout: z.string().optional(),
  console: z.boolean().optional(),
  timezone: z.string().optional(),
});

const uploadAvatarSchema = z.object({
  avatarData: z.string(),
});

const searchSchema = z.object({
  q: z.string().min(1).max(100),
  scope: z.enum(['tenant', 'team']).optional().default('tenant'),
  teamId: z.string().optional(),
}).refine(
  (data) => !(data.scope === 'team' && !data.teamId),
  { message: 'teamId is required when scope is team', path: ['teamId'] }
);

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
    const data = updateProfileSchema.parse(req.body);
    const result = await userService.updateProfile(req.user.userId, data);
    auditService.log({
      userId: req.user.userId, action: 'PROFILE_UPDATE',
      details: { fields: Object.keys(data) },
      ipAddress: getClientIp(req),
    });
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function changePassword(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { oldPassword, newPassword, verificationId } = changePasswordSchema.parse(req.body);
    const result = await userService.changePassword(
      req.user.userId, oldPassword, newPassword, verificationId,
    );
    auditService.log({ userId: req.user.userId, action: 'PASSWORD_CHANGE', ipAddress: getClientIp(req) });
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function initiateEmailChange(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { newEmail } = initiateEmailChangeSchema.parse(req.body);
    const result = await userService.initiateEmailChange(req.user.userId, newEmail);
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function confirmEmailChange(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const data = confirmEmailChangeSchema.parse(req.body);
    const result = await userService.confirmEmailChange(req.user.userId, data);
    auditService.log({
      userId: req.user.userId, action: 'PROFILE_EMAIL_CHANGE',
      details: { newEmail: result.email },
      ipAddress: getClientIp(req),
    });
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
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
    const { purpose } = initiateIdentitySchema.parse(req.body);
    const result = await identityVerification.initiateVerification(req.user.userId, purpose);
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function confirmIdentity(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { verificationId, code, credential, password } = confirmIdentitySchema.parse(req.body);
    const confirmed = await identityVerification.confirmVerification(
      verificationId, req.user.userId,
      { code, credential: credential as never, password },
    );
    res.json({ confirmed });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function updateSshDefaults(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const data = sshDefaultsSchema.parse(req.body);
    const result = await userService.updateSshDefaults(req.user.userId, data);
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function updateRdpDefaults(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const data = rdpDefaultsSchema.parse(req.body);
    const result = await userService.updateRdpDefaults(req.user.userId, data);
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function uploadAvatar(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { avatarData } = uploadAvatarSchema.parse(req.body);
    const result = await userService.uploadAvatar(req.user.userId, avatarData);
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function search(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertTenantAuthenticated(req);
    const { q, scope, teamId } = searchSchema.parse(req.query);
    const results = await userService.searchUsers(
      req.user.userId,
      req.user.tenantId,
      q,
      scope,
      teamId
    );
    res.json(results);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

// --- Domain Profile ---

const updateDomainProfileSchema = z.object({
  domainName: z.string().max(100).optional(),
  domainUsername: z.string().max(100).optional(),
  domainPassword: z.string().max(500).nullable().optional(),
});

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
    const data = updateDomainProfileSchema.parse(req.body);
    const result = await domainService.updateDomainProfile(req.user.userId, data);
    auditService.log({
      userId: req.user.userId, action: 'DOMAIN_PROFILE_UPDATE',
      details: { fields: Object.keys(data) },
      ipAddress: getClientIp(req),
    });
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
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
