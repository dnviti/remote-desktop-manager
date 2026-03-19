import { Response, NextFunction } from 'express';
import { AuthRequest, assertAuthenticated } from '../types';
import { getConnection } from '../services/connection.service';
import { createDbProxySession, endDbProxySession } from '../services/dbProxy.service';
import * as auditService from '../services/audit.service';
import { AppError } from '../middleware/error.middleware';
import { getClientIp } from '../utils/ip';

// ---- Database proxy session creation ----

export async function createSession(req: AuthRequest, res: Response, next: NextFunction) {
  let connectionId: string | undefined;

  try {
    assertAuthenticated(req);
    const { connectionId: connId, username, password } = req.body as {
      connectionId: string;
      username?: string;
      password?: string;
    };
    connectionId = connId;

    if (!connectionId) {
      throw new AppError('connectionId is required', 400);
    }

    // Validate the user can access this connection
    const conn = await getConnection(req.user.userId, connectionId, req.user.tenantId);
    if (conn.type !== 'DATABASE') {
      throw new AppError('Not a DATABASE connection', 400);
    }

    const result = await createDbProxySession({
      userId: req.user.userId,
      connectionId,
      tenantId: req.user.tenantId,
      ipAddress: getClientIp(req) ?? undefined,
      overrideUsername: username,
      overridePassword: password,
    });

    res.json(result);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    auditService.log({
      userId: req.user?.userId,
      action: 'SESSION_ERROR',
      targetType: 'Connection',
      targetId: connectionId,
      details: { protocol: 'DATABASE', error: errorMessage },
      ipAddress: getClientIp(req),
    });
    next(err);
  }
}

// ---- Database proxy session end ----

export async function endSession(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const sessionId = req.params.sessionId as string;
  await endDbProxySession(req.user.userId, sessionId);
  res.json({ ok: true });
}
