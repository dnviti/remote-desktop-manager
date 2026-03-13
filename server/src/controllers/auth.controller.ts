import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as authService from '../services/auth.service';
import * as passwordResetService from '../services/passwordReset.service';
import * as auditService from '../services/audit.service';
import { AppError } from '../middleware/error.middleware';
import { config } from '../config';
import { setRefreshTokenCookie, setCsrfCookie, clearAuthCookies } from '../utils/cookie';
import { getPublicConfig } from '../services/appConfig.service';
import type { AuthRequest } from '../types';
import { assertAuthenticated } from '../types';
import { getClientIp } from '../utils/ip';
import { getRequestBinding } from '../utils/tokenBinding';
import { verifyEmailSchema } from '../schemas/auth.schemas';
import type { RegisterInput, LoginInput, VerifyTotpInput, RequestSmsInput, VerifySmsInput, RequestWebAuthnInput, VerifyWebAuthnInput, ResendVerificationInput, MfaSetupTokenInput, MfaSetupVerifyInput, SwitchTenantInput, ForgotPasswordInput, ResetTokenInput, CompleteResetInput } from '../schemas/auth.schemas';

export async function register(req: Request, res: Response) {
  const { email, password } = req.body as RegisterInput;
  const result = await authService.register(email, password);
  auditService.log({ userId: result.userId, action: 'REGISTER', ipAddress: getClientIp(req) });
  res.status(201).json({
    message: result.message,
    emailVerifyRequired: result.emailVerifyRequired,
    recoveryKey: result.recoveryKey,
  });
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body as LoginInput;
    const result = await authService.login(email, password, getClientIp(req), getRequestBinding(req));

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
      auditService.log({ userId: result.user.id, action: 'LOGIN', ipAddress: getClientIp(req) });
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
    const { tempToken, code } = req.body as VerifyTotpInput;
    const result = await authService.verifyTotp(tempToken, code, getRequestBinding(req));
    auditService.log({ userId: result.user.id, action: 'LOGIN_TOTP', ipAddress: getClientIp(req) });
    setRefreshTokenCookie(res, result.refreshToken);
    const csrfToken = setCsrfCookie(res);
    res.json({ accessToken: result.accessToken, csrfToken, user: result.user, tenantMemberships: result.tenantMemberships });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === 'Invalid TOTP code') return next(new AppError(err.message, 401));
      if (err.message.includes('token')) return next(new AppError(err.message, 401));
      if (err.message === '2FA verification failed') return next(new AppError(err.message, 401));
    }
    next(err);
  }
}

export async function requestSmsCode(req: Request, res: Response, next: NextFunction) {
  try {
    const { tempToken } = req.body as RequestSmsInput;
    await authService.requestLoginSmsCode(tempToken);
    res.json({ message: 'SMS code sent' });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.includes('token')) return next(new AppError(err.message, 401));
      if (err.message.includes('not available')) return next(new AppError(err.message, 400));
    }
    next(err);
  }
}

export async function verifySms(req: Request, res: Response, next: NextFunction) {
  try {
    const { tempToken, code } = req.body as VerifySmsInput;
    const result = await authService.verifySmsCode(tempToken, code, getRequestBinding(req));
    auditService.log({ userId: result.user.id, action: 'LOGIN_SMS', ipAddress: getClientIp(req) });
    setRefreshTokenCookie(res, result.refreshToken);
    const csrfToken = setCsrfCookie(res);
    res.json({ accessToken: result.accessToken, csrfToken, user: result.user, tenantMemberships: result.tenantMemberships });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.includes('SMS code')) return next(new AppError(err.message, 401));
      if (err.message.includes('token')) return next(new AppError(err.message, 401));
      if (err.message.includes('verification failed')) return next(new AppError(err.message, 401));
    }
    next(err);
  }
}

export async function requestWebAuthnOptions(req: Request, res: Response, next: NextFunction) {
  try {
    const { tempToken } = req.body as RequestWebAuthnInput;
    const options = await authService.requestWebAuthnOptions(tempToken);
    res.json(options);
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.includes('token')) return next(new AppError(err.message, 401));
      if (err.message.includes('not available')) return next(new AppError(err.message, 400));
    }
    next(err);
  }
}

export async function verifyWebAuthn(req: Request, res: Response, next: NextFunction) {
  try {
    const { tempToken, credential } = req.body as VerifyWebAuthnInput;
    const result = await authService.verifyWebAuthn(tempToken, credential, getRequestBinding(req));
    auditService.log({ userId: result.user.id, action: 'LOGIN_WEBAUTHN', ipAddress: getClientIp(req) });
    setRefreshTokenCookie(res, result.refreshToken);
    const csrfToken = setCsrfCookie(res);
    res.json({ accessToken: result.accessToken, csrfToken, user: result.user, tenantMemberships: result.tenantMemberships });
  } catch (err) {
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
    const result = await authService.refreshAccessToken(refreshToken, getRequestBinding(req));
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

export async function logout(req: Request, res: Response) {
  const refreshToken = req.cookies?.[config.cookie.refreshTokenName];
  if (refreshToken) {
    const userId = await authService.logout(refreshToken);
    if (userId) {
      auditService.log({ userId, action: 'LOGOUT', ipAddress: getClientIp(req) });
    }
  }
  clearAuthCookies(res);
  res.json({ success: true });
}

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

export async function resendVerification(req: Request, res: Response) {
  const { email } = req.body as ResendVerificationInput;
  await authService.resendVerification(email);
  res.json({ message: 'If an account exists with this email, a verification link has been sent.' });
}

export async function mfaSetupInit(req: Request, res: Response, next: NextFunction) {
  try {
    const { tempToken } = req.body as MfaSetupTokenInput;
    const result = await authService.setupMfaDuringLogin(tempToken);
    res.json(result);
  } catch (err) {
    if (err instanceof AppError) return next(err);
    if (err instanceof Error) {
      if (err.message.includes('token')) return next(new AppError(err.message, 401));
    }
    next(err);
  }
}

export async function mfaSetupVerify(req: Request, res: Response, next: NextFunction) {
  try {
    const { tempToken, code } = req.body as MfaSetupVerifyInput;
    const result = await authService.verifyMfaSetupDuringLogin(tempToken, code, getRequestBinding(req));
    auditService.log({ userId: result.user.id, action: 'TOTP_ENABLE', ipAddress: getClientIp(req) });
    auditService.log({ userId: result.user.id, action: 'LOGIN', ipAddress: getClientIp(req) });
    setRefreshTokenCookie(res, result.refreshToken);
    const csrfToken = setCsrfCookie(res);
    res.json({ accessToken: result.accessToken, csrfToken, user: result.user, tenantMemberships: result.tenantMemberships });
  } catch (err) {
    if (err instanceof AppError) return next(err);
    if (err instanceof Error) {
      if (err.message.includes('token')) return next(new AppError(err.message, 401));
      if (err.message === 'Invalid TOTP code') return next(new AppError(err.message, 401));
    }
    next(err);
  }
}

// --- Tenant Switch ---

export async function switchTenant(req: Request, res: Response) {
  const authReq = req as AuthRequest;
  assertAuthenticated(authReq);
  const { tenantId } = req.body as SwitchTenantInput;
  const userId = authReq.user.userId;

  const result = await authService.switchTenant(userId, tenantId, getRequestBinding(req));

  auditService.log({
    userId,
    action: 'TENANT_SWITCH',
    targetType: 'Tenant',
    targetId: tenantId,
    ipAddress: getClientIp(req),
  });

  setRefreshTokenCookie(res, result.refreshToken);
  const csrfToken = setCsrfCookie(res);
  res.json({
    accessToken: result.accessToken,
    csrfToken,
    user: result.user,
  });
}

// --- Password Reset ---

export async function forgotPassword(req: Request, res: Response) {
  const { email } = req.body as ForgotPasswordInput;
  await passwordResetService.requestPasswordReset(email, getClientIp(req));
  res.json({ message: 'If an account exists with this email, a password reset link has been sent.' });
}

export async function validateResetToken(req: Request, res: Response) {
  const { token } = req.body as ResetTokenInput;
  const result = await passwordResetService.validateResetToken(token);
  if (!result.valid) {
    throw new AppError('Invalid or expired reset link.', 400);
  }
  res.json(result);
}

export async function requestResetSmsCode(req: Request, res: Response, next: NextFunction) {
  try {
    const { token } = req.body as ResetTokenInput;
    await passwordResetService.requestResetSmsCode(token);
    res.json({ message: 'SMS code sent' });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.includes('token')) return next(new AppError(err.message, 400));
      if (err.message.includes('not available')) return next(new AppError(err.message, 400));
    }
    next(err);
  }
}

export async function completePasswordReset(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as CompleteResetInput;
    const result = await passwordResetService.completePasswordReset({
      ...body,
      ipAddress: getClientIp(req),
    });
    res.json(result);
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.includes('token')) return next(new AppError(err.message, 400));
      if (err.message.includes('SMS')) return next(new AppError(err.message, 401));
    }
    next(err);
  }
}

export async function publicAuthConfig(_req: Request, res: Response) {
  const cfg = await getPublicConfig();
  res.json(cfg);
}
