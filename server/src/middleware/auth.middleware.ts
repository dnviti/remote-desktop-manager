import { Response, NextFunction } from 'express';
import { AuthPayload, AuthRequest } from '../types';
import { verifyJwt } from '../utils/jwt';
import { config } from '../config';
import { getClientIp } from '../utils/ip';
import { computeBindingHash } from '../utils/tokenBinding';
import * as auditService from '../services/audit.service';

export function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = verifyJwt<AuthPayload>(token);

    // Token binding check: verify IP + User-Agent hash matches
    if (config.tokenBindingEnabled && payload.ipUaHash) {
      const currentHash = computeBindingHash(
        getClientIp(req),
        req.get('user-agent') ?? '',
      );
      if (currentHash !== payload.ipUaHash) {
        auditService.log({
          userId: payload.userId,
          action: 'TOKEN_HIJACK_ATTEMPT',
          ipAddress: getClientIp(req),
          details: {
            reason: 'Access token presented from different IP/User-Agent',
          },
        });
        res.status(401).json({ error: 'Invalid or expired token' });
        return;
      }
    }

    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
