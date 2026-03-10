import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest, assertAuthenticated } from '../types';
import * as sharingService from '../services/sharing.service';
import * as auditService from '../services/audit.service';
import { AppError } from '../middleware/error.middleware';

const shareSchema = z.object({
  email: z.string().email().optional(),
  userId: z.string().optional(),
  permission: z.enum(['READ_ONLY', 'FULL_ACCESS']),
}).refine(
  (data) => data.email || data.userId,
  { message: 'Either email or userId is required' }
);

const updatePermSchema = z.object({
  permission: z.enum(['READ_ONLY', 'FULL_ACCESS']),
});

export async function share(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { email, userId, permission } = shareSchema.parse(req.body);
    const result = await sharingService.shareConnection(
      req.user.userId,
      req.params.id as string,
      { email, userId },
      permission,
      req.user.tenantId
    );
    auditService.log({
      userId: req.user.userId, action: 'SHARE_CONNECTION',
      targetType: 'Connection', targetId: req.params.id as string,
      details: { sharedWith: userId || email, permission },
      ipAddress: req.ip,
    });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

const batchShareSchema = z.object({
  connectionIds: z.array(z.string().uuid()).min(1).max(50),
  target: z.union([
    z.object({ email: z.string().email(), userId: z.undefined().optional() }),
    z.object({ userId: z.string().uuid(), email: z.undefined().optional() }),
  ]),
  permission: z.enum(['READ_ONLY', 'FULL_ACCESS']),
  folderName: z.string().optional(),
});

export async function batchShare(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { connectionIds, target, permission, folderName } = batchShareSchema.parse(req.body);
    const result = await sharingService.batchShareConnections(
      req.user.userId,
      connectionIds,
      target,
      permission,
      req.user.tenantId,
      folderName
    );
    auditService.log({
      userId: req.user.userId, action: 'BATCH_SHARE',
      targetType: 'Connection',
      details: { connectionCount: connectionIds.length, shared: result.shared, failed: result.failed, permission },
      ipAddress: req.ip,
    });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function unshare(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const result = await sharingService.unshareConnection(
      req.user.userId,
      req.params.id as string,
      req.params.userId as string,
      req.user.tenantId
    );
    auditService.log({
      userId: req.user.userId, action: 'UNSHARE_CONNECTION',
      targetType: 'Connection', targetId: req.params.id as string,
      details: { targetUserId: req.params.userId },
      ipAddress: req.ip,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function updatePermission(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { permission } = updatePermSchema.parse(req.body);
    const result = await sharingService.updateSharePermission(
      req.user.userId,
      req.params.id as string,
      req.params.userId as string,
      permission,
      req.user.tenantId
    );
    auditService.log({
      userId: req.user.userId, action: 'UPDATE_SHARE_PERMISSION',
      targetType: 'Connection', targetId: req.params.id as string,
      details: { targetUserId: req.params.userId, permission },
      ipAddress: req.ip,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function listShares(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const result = await sharingService.listShares(req.user.userId, req.params.id as string, req.user.tenantId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
