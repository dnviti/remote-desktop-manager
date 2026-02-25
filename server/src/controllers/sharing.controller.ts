import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import * as sharingService from '../services/sharing.service';
import { AppError } from '../middleware/error.middleware';

const shareSchema = z.object({
  email: z.string().email(),
  permission: z.enum(['READ_ONLY', 'FULL_ACCESS']),
});

const updatePermSchema = z.object({
  permission: z.enum(['READ_ONLY', 'FULL_ACCESS']),
});

export async function share(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { email, permission } = shareSchema.parse(req.body);
    const result = await sharingService.shareConnection(
      req.user!.userId,
      req.params.id as string,
      email,
      permission
    );
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.errors[0].message, 400));
    next(err);
  }
}

export async function unshare(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await sharingService.unshareConnection(
      req.user!.userId,
      req.params.id as string,
      req.params.userId as string
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function updatePermission(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { permission } = updatePermSchema.parse(req.body);
    const result = await sharingService.updateSharePermission(
      req.user!.userId,
      req.params.id as string,
      req.params.userId as string,
      permission
    );
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.errors[0].message, 400));
    next(err);
  }
}

export async function listShares(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await sharingService.listShares(req.user!.userId, req.params.id as string);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
