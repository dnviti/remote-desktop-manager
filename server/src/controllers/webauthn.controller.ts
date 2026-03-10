import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest, assertAuthenticated } from '../types';
import { AppError } from '../middleware/error.middleware';
import * as auditService from '../services/audit.service';
import * as webauthnService from '../services/webauthn.service';

const registerSchema = z.object({
  credential: z.record(z.string(), z.unknown()),
  friendlyName: z.string().min(1).max(64).optional(),
});

const renameSchema = z.object({
  friendlyName: z.string().min(1).max(64),
});

export async function registrationOptions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const options = await webauthnService.generateRegistrationOpts(req.user.userId);
    res.json(options);
  } catch (err) {
    if (err instanceof AppError) return next(err);
    next(err);
  }
}

export async function register(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { credential, friendlyName } = registerSchema.parse(req.body);
    const result = await webauthnService.verifyRegistration(
      req.user.userId,
      credential as unknown as Parameters<typeof webauthnService.verifyRegistration>[1],
      friendlyName,
    );
    auditService.log({
      userId: req.user.userId,
      action: 'WEBAUTHN_REGISTER',
      targetType: 'WebAuthnCredential',
      targetId: result.id,
      details: { friendlyName: result.friendlyName, deviceType: result.deviceType },
      ipAddress: req.ip,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError('Invalid registration data', 400));
    if (err instanceof AppError) return next(err);
    next(err);
  }
}

export async function getCredentials(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const credentials = await webauthnService.getCredentials(req.user.userId);
    res.json(credentials);
  } catch (err) {
    next(err);
  }
}

export async function removeCredential(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const credentialId = req.params.id as string;
    await webauthnService.removeCredential(req.user.userId, credentialId);
    auditService.log({
      userId: req.user.userId,
      action: 'WEBAUTHN_REMOVE',
      targetType: 'WebAuthnCredential',
      targetId: credentialId,
      ipAddress: req.ip,
    });
    res.json({ removed: true });
  } catch (err) {
    if (err instanceof AppError) return next(err);
    next(err);
  }
}

export async function renameCredential(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const credentialId = req.params.id as string;
    const { friendlyName } = renameSchema.parse(req.body);
    await webauthnService.renameCredential(req.user.userId, credentialId, friendlyName);
    res.json({ renamed: true });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError('Invalid name', 400));
    if (err instanceof AppError) return next(err);
    next(err);
  }
}

export async function status(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const result = await webauthnService.getWebAuthnStatus(req.user.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
