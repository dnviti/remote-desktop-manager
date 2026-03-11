import { Response, NextFunction } from 'express';
import { AuthRequest, assertAuthenticated } from '../types';
import { AppError } from '../middleware/error.middleware';
import * as auditService from '../services/audit.service';
import * as totpService from '../services/totp.service';
import prisma from '../lib/prisma';
import { getClientIp } from '../utils/ip';
import type { TotpCodeInput } from '../schemas/mfa.schemas';

export async function setup(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { email: true, totpEnabled: true },
    });
    if (!user) return next(new AppError('User not found', 404));
    if (user.totpEnabled) return next(new AppError('2FA is already enabled', 400));

    const { secret, otpauthUri } = totpService.generateSetup(user.email);
    await totpService.storeSetupSecret(req.user.userId, secret);

    res.json({ secret, otpauthUri });
  } catch (err) {
    if (err instanceof AppError) return next(err);
    next(err);
  }
}

export async function verify(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { code } = req.body as TotpCodeInput;
    await totpService.verifyAndEnable(req.user.userId, code);
    auditService.log({ userId: req.user.userId, action: 'TOTP_ENABLE', ipAddress: getClientIp(req) });
    res.json({ enabled: true });
  } catch (err) {
    if (err instanceof AppError) return next(err);
    next(err);
  }
}

export async function disable(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { code } = req.body as TotpCodeInput;
    await totpService.disable(req.user.userId, code);
    auditService.log({ userId: req.user.userId, action: 'TOTP_DISABLE', ipAddress: getClientIp(req) });
    res.json({ enabled: false });
  } catch (err) {
    if (err instanceof AppError) return next(err);
    next(err);
  }
}

export async function status(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { totpEnabled: true },
    });
    res.json({ enabled: user?.totpEnabled ?? false });
  } catch (err) {
    next(err);
  }
}
