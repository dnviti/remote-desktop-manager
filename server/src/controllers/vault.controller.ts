import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import * as vaultService from '../services/vault.service';
import { AppError } from '../middleware/error.middleware';

const unlockSchema = z.object({ password: z.string() });
const revealSchema = z.object({
  connectionId: z.string().uuid(),
  password: z.string().optional(),
});

export async function unlock(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { password } = unlockSchema.parse(req.body);
    const result = await vaultService.unlockVault(req.user!.userId, password);
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.errors[0].message, 400));
    next(err);
  }
}

export function lock(req: AuthRequest, res: Response) {
  const result = vaultService.lockVault(req.user!.userId);
  res.json(result);
}

export function status(req: AuthRequest, res: Response) {
  const result = vaultService.getVaultStatus(req.user!.userId);
  res.json(result);
}

export async function revealPassword(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { connectionId, password } = revealSchema.parse(req.body);
    const result = await vaultService.revealPassword(
      req.user!.userId,
      connectionId,
      password || ''
    );
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.errors[0].message, 400));
    next(err);
  }
}
