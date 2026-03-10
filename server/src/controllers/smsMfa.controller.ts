import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest, assertAuthenticated } from '../types';
import { AppError } from '../middleware/error.middleware';
import * as auditService from '../services/audit.service';
import * as smsOtpService from '../services/smsOtp.service';
import prisma from '../lib/prisma';

const setupPhoneSchema = z.object({
  phoneNumber: z.string().regex(/^\+[1-9]\d{1,14}$/, 'Invalid E.164 phone number'),
});

const codeSchema = z.object({
  code: z.string().length(6).regex(/^\d{6}$/),
});

export async function setupPhone(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { phoneNumber } = setupPhoneSchema.parse(req.body);
    await smsOtpService.setupPhone(req.user.userId, phoneNumber);
    res.json({ message: 'Verification code sent' });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError('Invalid phone number format', 400));
    if (err instanceof AppError) return next(err);
    next(err);
  }
}

export async function verifyPhone(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { code } = codeSchema.parse(req.body);
    await smsOtpService.verifyPhone(req.user.userId, code);
    auditService.log({ userId: req.user.userId, action: 'SMS_PHONE_VERIFY', ipAddress: req.ip });
    res.json({ verified: true });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError('Invalid code format', 400));
    if (err instanceof AppError) return next(err);
    next(err);
  }
}

export async function enable(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    await smsOtpService.enableSmsMfa(req.user.userId);
    auditService.log({ userId: req.user.userId, action: 'SMS_MFA_ENABLE', ipAddress: req.ip });
    res.json({ enabled: true });
  } catch (err) {
    if (err instanceof AppError) return next(err);
    next(err);
  }
}

export async function sendDisableCode(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { phoneNumber: true, smsMfaEnabled: true },
    });
    if (!user?.smsMfaEnabled || !user.phoneNumber) {
      return next(new AppError('SMS MFA is not enabled', 400));
    }
    await smsOtpService.sendOtpToPhone(req.user.userId, user.phoneNumber);
    res.json({ message: 'Verification code sent' });
  } catch (err) {
    if (err instanceof AppError) return next(err);
    next(err);
  }
}

export async function disable(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { code } = codeSchema.parse(req.body);
    await smsOtpService.disableSmsMfa(req.user.userId, code);
    auditService.log({ userId: req.user.userId, action: 'SMS_MFA_DISABLE', ipAddress: req.ip });
    res.json({ enabled: false });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError('Invalid code format', 400));
    if (err instanceof AppError) return next(err);
    next(err);
  }
}

export async function status(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const result = await smsOtpService.getSmsMfaStatus(req.user.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
