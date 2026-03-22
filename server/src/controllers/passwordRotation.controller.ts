import { Response } from 'express';
import { AuthRequest, assertAuthenticated } from '../types';
import * as passwordRotationService from '../services/passwordRotation.service';
import * as auditService from '../services/audit.service';
import { getClientIp } from '../utils/ip';
import type { EnableRotationInput } from '../schemas/passwordRotation.schemas';

export async function enableRotation(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const secretId = req.params.id as string;
  const { intervalDays } = req.body as EnableRotationInput;

  await passwordRotationService.enableRotation(
    req.user.userId,
    secretId,
    intervalDays,
    req.user.tenantId,
  );

  auditService.log({
    userId: req.user.userId,
    action: 'SECRET_UPDATE',
    targetType: 'VaultSecret',
    targetId: secretId,
    details: { field: 'targetRotationEnabled', value: true, intervalDays },
    ipAddress: getClientIp(req),
  });

  res.json({ enabled: true, intervalDays: intervalDays ?? 30 });
}

export async function disableRotation(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const secretId = req.params.id as string;

  await passwordRotationService.disableRotation(
    req.user.userId,
    secretId,
    req.user.tenantId,
  );

  auditService.log({
    userId: req.user.userId,
    action: 'SECRET_UPDATE',
    targetType: 'VaultSecret',
    targetId: secretId,
    details: { field: 'targetRotationEnabled', value: false },
    ipAddress: getClientIp(req),
  });

  res.json({ enabled: false });
}

export async function triggerRotation(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const secretId = req.params.id as string;

  const result = await passwordRotationService.rotatePassword(
    secretId,
    req.user.userId,
    'MANUAL',
  );

  res.json(result);
}

export async function getRotationStatus(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const { secretId } = req.body as { secretId: string };

  const status = await passwordRotationService.getRotationStatus(secretId);
  res.json(status);
}

export async function getRotationHistory(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const { secretId } = req.body as { secretId: string };
  const limit = req.body.limit ? parseInt(String(req.body.limit), 10) : 20;

  const history = await passwordRotationService.getRotationHistory(secretId, limit);
  res.json(history);
}
