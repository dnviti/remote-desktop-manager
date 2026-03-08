import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as authService from '../services/auth.service';
import * as passwordResetService from '../services/passwordReset.service';
import * as auditService from '../services/audit.service';
import { AppError } from '../middleware/error.middleware';
import { config } from '../config';
import { setRefreshTokenCookie, setCsrfCookie, clearAuthCookies } from '../utils/cookie';
import { getPublicConfig } from '../services/appConfig.service';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = registerSchema.parse(req.body);
    const result = await authService.register(email, password);
    auditService.log({ userId: result.userId, action: 'REGISTER', ipAddress: req.ip });
    res.status(201).json({
      message: result.message,
      emailVerifyRequired: result.emailVerifyRequired,
      recoveryKey: result.recoveryKey,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return next(new AppError(err.issues[0].message, 400));
    }
    if (err instanceof Error && err.message === 'Email already registered') {
      return next(new AppError(err.message, 409));
    }
    next(err);
  }
}

const verifyTotpSchema = z.object({
  tempToken: z.string(),
  code: z.string().length(6).regex(/^\d{6}$/),
});

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const result = await authService.login(email, password, req.ip);

    if ('mfaSetupRequired' in result && result.mfaSetupRequired) {
      res.json({
        mfaSetupRequired: true,
        tempToken: result.tempToken,
      });
      return;
    }

    if ('requiresMFA' in result && result.requiresMFA) {
      res.json({
        requiresMFA: true,
        requiresTOTP: result.requiresTOTP,
        methods: result.methods,
        tempToken: result.tempToken,
      });
    } else if (!('requiresMFA' in result) || !result.requiresMFA) {
      auditService.log({ userId: result.user.id, action: 'LOGIN', ipAddress: req.ip });
      setRefreshTokenCookie(res, result.refreshToken);
      const csrfToken = setCsrfCookie(res);
      res.json({
        accessToken: result.accessToken,
        csrfToken,
        user: result.user,
        tenantMemberships: result.tenantMemberships,
      });
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      return next(new AppError(err.issues[0].message, 400));
    }
    if (err instanceof AppError) {
      return next(err);
    }
    if (err instanceof Error && err.message === 'Invalid email or password') {
      return next(new AppError(err.message, 401));
    }
    next(err);
  }
}

export async function verifyTotp(req: Request, res: Response, next: NextFunction) {
  try {
    const { tempToken, code } = verifyTotpSchema.parse(req.body);
    const result = await authService.verifyTotp(tempToken, code);
    auditService.log({ userId: result.user.id, action: 'LOGIN_TOTP', ipAddress: req.ip });
    setRefreshTokenCookie(res, result.refreshToken);
    const csrfToken = setCsrfCookie(res);
    res.json({ accessToken: result.accessToken, csrfToken, user: result.user, tenantMemberships: result.tenantMemberships });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return next(new AppError('Invalid code format', 400));
    }
    if (err instanceof Error) {
      if (err.message === 'Invalid TOTP code') return next(new AppError(err.message, 401));
      if (err.message.includes('token')) return next(new AppError(err.message, 401));
      if (err.message === '2FA verification failed') return next(new AppError(err.message, 401));
    }
    next(err);
  }
}

const requestSmsSchema = z.object({
  tempToken: z.string(),
});

const verifySmsSchema = z.object({
  tempToken: z.string(),
  code: z.string().length(6).regex(/^\d{6}$/),
});

export async function requestSmsCode(req: Request, res: Response, next: NextFunction) {
  try {
    const { tempToken } = requestSmsSchema.parse(req.body);
    await authService.requestLoginSmsCode(tempToken);
    res.json({ message: 'SMS code sent' });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError('Invalid request', 400));
    if (err instanceof Error) {
      if (err.message.includes('token')) return next(new AppError(err.message, 401));
      if (err.message.includes('not available')) return next(new AppError(err.message, 400));
    }
    next(err);
  }
}

export async function verifySms(req: Request, res: Response, next: NextFunction) {
  try {
    const { tempToken, code } = verifySmsSchema.parse(req.body);
    const result = await authService.verifySmsCode(tempToken, code);
    auditService.log({ userId: result.user.id, action: 'LOGIN_SMS', ipAddress: req.ip });
    setRefreshTokenCookie(res, result.refreshToken);
    const csrfToken = setCsrfCookie(res);
    res.json({ accessToken: result.accessToken, csrfToken, user: result.user, tenantMemberships: result.tenantMemberships });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError('Invalid code format', 400));
    if (err instanceof Error) {
      if (err.message.includes('SMS code')) return next(new AppError(err.message, 401));
      if (err.message.includes('token')) return next(new AppError(err.message, 401));
      if (err.message.includes('verification failed')) return next(new AppError(err.message, 401));
    }
    next(err);
  }
}

const requestWebAuthnSchema = z.object({
  tempToken: z.string(),
});

const verifyWebAuthnSchema = z.object({
  tempToken: z.string(),
  credential: z.record(z.string(), z.unknown()),
});

export async function requestWebAuthnOptions(req: Request, res: Response, next: NextFunction) {
  try {
    const { tempToken } = requestWebAuthnSchema.parse(req.body);
    const options = await authService.requestWebAuthnOptions(tempToken);
    res.json(options);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError('Invalid request', 400));
    if (err instanceof Error) {
      if (err.message.includes('token')) return next(new AppError(err.message, 401));
      if (err.message.includes('not available')) return next(new AppError(err.message, 400));
    }
    next(err);
  }
}

export async function verifyWebAuthn(req: Request, res: Response, next: NextFunction) {
  try {
    const { tempToken, credential } = verifyWebAuthnSchema.parse(req.body);
    const result = await authService.verifyWebAuthn(tempToken, credential);
    auditService.log({ userId: result.user.id, action: 'LOGIN_WEBAUTHN', ipAddress: req.ip });
    setRefreshTokenCookie(res, result.refreshToken);
    const csrfToken = setCsrfCookie(res);
    res.json({ accessToken: result.accessToken, csrfToken, user: result.user, tenantMemberships: result.tenantMemberships });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError('Invalid request', 400));
    if (err instanceof AppError) return next(err);
    if (err instanceof Error) {
      if (err.message.includes('token')) return next(new AppError(err.message, 401));
      if (err.message.includes('verification failed')) return next(new AppError(err.message, 401));
      if (err.message.includes('expired')) return next(new AppError(err.message, 400));
      if (err.message.includes('not found')) return next(new AppError(err.message, 400));
    }
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    const refreshToken = req.cookies?.[config.cookie.refreshTokenName];
    if (!refreshToken) {
      return next(new AppError('Missing refresh token', 401));
    }
    const result = await authService.refreshAccessToken(refreshToken);
    setRefreshTokenCookie(res, result.refreshToken);
    const csrfToken = setCsrfCookie(res);
    res.json({ accessToken: result.accessToken, csrfToken, user: result.user });
  } catch (err) {
    if (err instanceof Error && err.message.includes('refresh token')) {
      clearAuthCookies(res);
      return next(new AppError(err.message, 401));
    }
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    const refreshToken = req.cookies?.[config.cookie.refreshTokenName];
    if (refreshToken) {
      const userId = await authService.logout(refreshToken);
      if (userId) {
        auditService.log({ userId, action: 'LOGOUT', ipAddress: req.ip });
      }
    }
    clearAuthCookies(res);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

const verifyEmailSchema = z.object({
  token: z.string().length(64),
});

const resendVerificationSchema = z.object({
  email: z.string().email(),
});

export async function verifyEmail(req: Request, res: Response, next: NextFunction) {
  try {
    const { token } = verifyEmailSchema.parse(req.query);
    await authService.verifyEmail(token);
    res.redirect(`${config.clientUrl}/login?verified=true`);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.redirect(`${config.clientUrl}/login?verifyError=${encodeURIComponent('Invalid verification link.')}`);
    }
    if (err instanceof AppError) {
      return res.redirect(`${config.clientUrl}/login?verifyError=${encodeURIComponent(err.message)}`);
    }
    next(err);
  }
}

export async function resendVerification(req: Request, res: Response, next: NextFunction) {
  try {
    const { email } = resendVerificationSchema.parse(req.body);
    await authService.resendVerification(email);
    res.json({ message: 'If an account exists with this email, a verification link has been sent.' });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return next(new AppError('Invalid email format', 400));
    }
    next(err);
  }
}

const mfaSetupTokenSchema = z.object({
  tempToken: z.string(),
});

const mfaSetupVerifySchema = z.object({
  tempToken: z.string(),
  code: z.string().length(6).regex(/^\d{6}$/),
});

export async function mfaSetupInit(req: Request, res: Response, next: NextFunction) {
  try {
    const { tempToken } = mfaSetupTokenSchema.parse(req.body);
    const result = await authService.setupMfaDuringLogin(tempToken);
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError('Invalid request', 400));
    if (err instanceof AppError) return next(err);
    if (err instanceof Error) {
      if (err.message.includes('token')) return next(new AppError(err.message, 401));
    }
    next(err);
  }
}

export async function mfaSetupVerify(req: Request, res: Response, next: NextFunction) {
  try {
    const { tempToken, code } = mfaSetupVerifySchema.parse(req.body);
    const result = await authService.verifyMfaSetupDuringLogin(tempToken, code);
    auditService.log({ userId: result.user.id, action: 'TOTP_ENABLE', ipAddress: req.ip });
    auditService.log({ userId: result.user.id, action: 'LOGIN', ipAddress: req.ip });
    setRefreshTokenCookie(res, result.refreshToken);
    const csrfToken = setCsrfCookie(res);
    res.json({ accessToken: result.accessToken, csrfToken, user: result.user, tenantMemberships: result.tenantMemberships });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError('Invalid code format', 400));
    if (err instanceof AppError) return next(err);
    if (err instanceof Error) {
      if (err.message.includes('token')) return next(new AppError(err.message, 401));
      if (err.message === 'Invalid TOTP code') return next(new AppError(err.message, 401));
    }
    next(err);
  }
}

// --- Tenant Switch ---

const switchTenantSchema = z.object({
  tenantId: z.string().uuid(),
});

export async function switchTenant(req: Request, res: Response, next: NextFunction) {
  try {
    const { tenantId } = switchTenantSchema.parse(req.body);
    const userId = (req as any).user?.userId;
    if (!userId) return next(new AppError('Authentication required', 401));

    const result = await authService.switchTenant(userId, tenantId);

    auditService.log({
      userId,
      action: 'TENANT_SWITCH',
      targetType: 'Tenant',
      targetId: tenantId,
      ipAddress: req.ip,
    });

    setRefreshTokenCookie(res, result.refreshToken);
    const csrfToken = setCsrfCookie(res);
    res.json({
      accessToken: result.accessToken,
      csrfToken,
      user: result.user,
    });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

// --- Password Reset ---

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetTokenSchema = z.object({
  token: z.string().length(64),
});

const completeResetSchema = z.object({
  token: z.string().length(64),
  newPassword: z.string().min(8),
  smsCode: z.string().length(6).regex(/^\d{6}$/).optional(),
  recoveryKey: z.string().optional(),
});

export async function forgotPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);
    await passwordResetService.requestPasswordReset(email, req.ip);
    res.json({ message: 'If an account exists with this email, a password reset link has been sent.' });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return next(new AppError('Invalid email format', 400));
    }
    next(err);
  }
}

export async function validateResetToken(req: Request, res: Response, next: NextFunction) {
  try {
    const { token } = resetTokenSchema.parse(req.body);
    const result = await passwordResetService.validateResetToken(token);
    if (!result.valid) {
      return next(new AppError('Invalid or expired reset link.', 400));
    }
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return next(new AppError('Invalid token format', 400));
    }
    next(err);
  }
}

export async function requestResetSmsCode(req: Request, res: Response, next: NextFunction) {
  try {
    const { token } = resetTokenSchema.parse(req.body);
    await passwordResetService.requestResetSmsCode(token);
    res.json({ message: 'SMS code sent' });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError('Invalid request', 400));
    if (err instanceof Error) {
      if (err.message.includes('token')) return next(new AppError(err.message, 400));
      if (err.message.includes('not available')) return next(new AppError(err.message, 400));
    }
    next(err);
  }
}

export async function completePasswordReset(req: Request, res: Response, next: NextFunction) {
  try {
    const body = completeResetSchema.parse(req.body);
    const result = await passwordResetService.completePasswordReset({
      ...body,
      ipAddress: req.ip,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return next(new AppError(err.issues[0].message, 400));
    }
    if (err instanceof Error) {
      if (err.message.includes('token')) return next(new AppError(err.message, 400));
      if (err.message.includes('SMS')) return next(new AppError(err.message, 401));
    }
    next(err);
  }
}

export async function publicAuthConfig(_req: Request, res: Response, next: NextFunction) {
  try {
    const cfg = await getPublicConfig();
    res.json(cfg);
  } catch (err) {
    next(err);
  }
}
