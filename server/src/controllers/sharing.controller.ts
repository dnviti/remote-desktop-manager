import { Response, NextFunction } from 'express';
import { AuthRequest, assertAuthenticated } from '../types';
import * as sharingService from '../services/sharing.service';
import * as auditService from '../services/audit.service';
import { getClientIp } from '../utils/ip';
import type { ShareInput, BatchShareInput, UpdatePermissionInput } from '../schemas/sharing.schemas';

export async function share(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { email, userId, permission } = req.body as ShareInput;
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
      ipAddress: getClientIp(req),
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function batchShare(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { connectionIds, target, permission, folderName } = req.body as BatchShareInput;
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
      ipAddress: getClientIp(req),
    });
    res.status(200).json(result);
  } catch (err) {
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
      ipAddress: getClientIp(req),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function updatePermission(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { permission } = req.body as UpdatePermissionInput;
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
      ipAddress: getClientIp(req),
    });
    res.json(result);
  } catch (err) {
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
