import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest, assertAuthenticated } from '../types';
import { AppError } from '../middleware/error.middleware';
import * as externalShareService from '../services/externalShare.service';
import { getClientIp } from '../utils/ip';

// --- Zod schemas ---

const createExternalShareSchema = z.object({
  expiresInMinutes: z.number().int().min(5).max(43200), // 5 min to 30 days
  maxAccessCount: z.number().int().min(1).max(1000).optional(),
  pin: z.string().regex(/^\d{4,8}$/, 'PIN must be 4-8 digits').optional(),
});

const accessExternalShareSchema = z.object({
  pin: z.string().regex(/^\d{4,8}$/).optional(),
});

// --- Authenticated handlers ---

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const body = createExternalShareSchema.parse(req.body);
    const secretId = req.params.id as string;
    const userId = req.user.userId;
    const tenantId = req.user.tenantId;

    const result = await externalShareService.createExternalShare(
      userId,
      secretId,
      body,
      tenantId,
    );

    res.status(201).json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function revoke(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const shareId = req.params.shareId as string;
    const userId = req.user.userId;
    const tenantId = req.user.tenantId;

    await externalShareService.revokeExternalShare(userId, shareId, tenantId);
    res.json({ revoked: true });
  } catch (err) {
    next(err);
  }
}

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const secretId = req.params.id as string;
    const userId = req.user.userId;
    const tenantId = req.user.tenantId;

    const shares = await externalShareService.listExternalShares(userId, secretId, tenantId);
    res.json(shares);
  } catch (err) {
    next(err);
  }
}

// --- Public handlers (no auth) ---

export async function getInfo(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.params.token as string;
    const info = await externalShareService.getExternalShareInfo(token);
    res.json(info);
  } catch (err) {
    next(err);
  }
}

export async function access(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.params.token as string;
    const body = accessExternalShareSchema.parse(req.body);
    const ipAddress = getClientIp(req);

    const result = await externalShareService.accessExternalShare(
      token,
      body.pin,
      ipAddress,
    );

    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}
