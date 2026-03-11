import { Request, Response, NextFunction } from 'express';
import { AuthRequest, assertAuthenticated } from '../types';
import * as externalShareService from '../services/externalShare.service';
import { getClientIp } from '../utils/ip';
import type { CreateExternalShareInput, AccessExternalShareInput } from '../schemas/externalShare.schemas';

// --- Authenticated handlers ---

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const body = req.body as CreateExternalShareInput;
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
    const body = req.body as AccessExternalShareInput;
    const ipAddress = getClientIp(req);

    const result = await externalShareService.accessExternalShare(
      token,
      body.pin,
      ipAddress,
    );

    res.json(result);
  } catch (err) {
    next(err);
  }
}
