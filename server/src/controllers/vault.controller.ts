import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest, assertAuthenticated } from '../types';
import * as vaultService from '../services/vault.service';
import * as auditService from '../services/audit.service';
import { AppError } from '../middleware/error.middleware';

const unlockSchema = z.object({ password: z.string() });
const codeSchema = z.object({ code: z.string() });
const credentialSchema = z.object({ credential: z.record(z.string(), z.unknown()) });
const revealSchema = z.object({
  connectionId: z.string().uuid(),
  password: z.string().optional(),
});
const autoLockSchema = z.object({
  autoLockMinutes: z.number().int().min(0).nullable(),
});

export async function unlock(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { password } = unlockSchema.parse(req.body);
    const result = await vaultService.unlockVault(req.user.userId, password);
    auditService.log({ userId: req.user.userId, action: 'VAULT_UNLOCK', ipAddress: req.ip });
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export function lock(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const result = vaultService.lockVault(req.user.userId);
  auditService.log({ userId: req.user.userId, action: 'VAULT_LOCK', ipAddress: req.ip });
  res.json(result);
}

export async function status(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const result = await vaultService.getVaultStatus(req.user.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function unlockWithTotp(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { code } = codeSchema.parse(req.body);
    const result = await vaultService.unlockVaultWithTotp(req.user.userId, code);
    auditService.log({ userId: req.user.userId, action: 'VAULT_UNLOCK', ipAddress: req.ip, details: { method: 'totp' } });
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function requestWebAuthnOptions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const options = await vaultService.requestVaultWebAuthnOptions(req.user.userId);
    res.json(options);
  } catch (err) {
    next(err);
  }
}

export async function unlockWithWebAuthn(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { credential } = credentialSchema.parse(req.body);
    const result = await vaultService.unlockVaultWithWebAuthn(req.user.userId, credential);
    auditService.log({ userId: req.user.userId, action: 'VAULT_UNLOCK', ipAddress: req.ip, details: { method: 'webauthn' } });
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function requestSmsCode(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    await vaultService.requestVaultSmsCode(req.user.userId);
    res.json({ sent: true });
  } catch (err) {
    next(err);
  }
}

export async function unlockWithSms(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { code } = codeSchema.parse(req.body);
    const result = await vaultService.unlockVaultWithSms(req.user.userId, code);
    auditService.log({ userId: req.user.userId, action: 'VAULT_UNLOCK', ipAddress: req.ip, details: { method: 'sms' } });
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function getAutoLock(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const result = await vaultService.getAutoLockPreference(req.user.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function setAutoLock(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { autoLockMinutes } = autoLockSchema.parse(req.body);
    const result = await vaultService.setAutoLockPreference(req.user.userId, autoLockMinutes);
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function revealPassword(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { connectionId, password } = revealSchema.parse(req.body);
    const result = await vaultService.revealPassword(
      req.user.userId,
      connectionId,
      password || ''
    );
    auditService.log({
      userId: req.user.userId, action: 'PASSWORD_REVEAL',
      targetType: 'Connection', targetId: connectionId,
      ipAddress: req.ip,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}
