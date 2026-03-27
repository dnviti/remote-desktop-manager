import type { Request, Response, NextFunction } from 'express';
import * as setupService from '../services/setup.service';
import type { SetupCompleteInput } from '../schemas/setup.schemas';
import { getClientIp } from '../utils/ip';
import * as auditService from '../services/audit.service';
import { setRefreshTokenCookie, setCsrfCookie } from '../utils/cookie';

export async function getSetupStatus(_req: Request, res: Response) {
  const required = await setupService.isSetupRequired();
  res.json({ required });
}

export async function getDbStatus(_req: Request, res: Response) {
  const required = await setupService.isSetupRequired();
  if (!required) {
    // After setup is completed, only return minimal connectivity info
    // to avoid leaking infrastructure details to unauthenticated clients.
    // Authenticated admins can use /admin/system-settings/db-status instead.
    res.status(403).json({ error: 'Setup has already been completed' });
    return;
  }
  const status = await setupService.getDbStatus();
  res.json(status);
}

export async function completeSetup(req: Request, res: Response, next: NextFunction) {
  try {
    const required = await setupService.isSetupRequired();
    if (!required) {
      res.status(403).json({ error: 'Setup has already been completed' });
      return;
    }

    const data = req.body as SetupCompleteInput;
    const result = await setupService.completeSetup(data);

    // Audit log the initial setup
    auditService.log({
      userId: result.user.id,
      action: 'REGISTER',
      details: { via: 'setup-wizard', tenant: result.tenant.name },
      ipAddress: getClientIp(req),
    });

    // Set cookies (same pattern as auth.controller.ts login)
    setRefreshTokenCookie(res, result.refreshToken);
    const csrfToken = setCsrfCookie(res);

    res.status(201).json({
      recoveryKey: result.recoveryKey,
      accessToken: result.accessToken,
      csrfToken,
      user: result.user,
      tenant: result.tenant,
      tenantMemberships: result.tenantMemberships,
      systemSecrets: result.systemSecrets,
    });
  } catch (err) {
    next(err);
  }
}
