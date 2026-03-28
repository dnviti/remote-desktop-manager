import { Response, NextFunction } from 'express';
import { AuthPayload, AuthRequest, TenantRoleType } from '../types';
import { verifyJwt } from '../utils/jwt';
import { config } from '../config';
import { getClientIp } from '../utils/ip';
import { computeBindingHash } from '../utils/tokenBinding';
import * as auditService from '../services/audit.service';
import {
  getTenantMembershipContext,
  isTenantMembershipUsable,
} from '../utils/tenantMembership';

const ROLE_HIERARCHY: Record<string, number> = {
  GUEST:      0.1,
  AUDITOR:    0.3,
  CONSULTANT: 0.5,
  MEMBER:     1,
  OPERATOR:   2,
  ADMIN:      3,
  OWNER:      4,
};

export async function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = verifyJwt<AuthPayload & { type?: string }>(token);

    // Reject non-access tokens (e.g. refresh tokens) to prevent token type confusion
    if (payload.type !== 'access') {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

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

    // Normalize tenant context against the live membership row so role changes,
    // pending invitations, and expirations take effect before route handlers run.
    if (payload.tenantId) {
      const membership = await getTenantMembershipContext(payload.userId, payload.tenantId);
      if (isTenantMembershipUsable(membership)) {
        payload.tenantRole = membership.role;
      } else {
        delete payload.tenantId;
        delete payload.tenantRole;
      }
    } else if (payload.tenantRole) {
      delete payload.tenantRole;
    }

    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Middleware that enforces a tenant role after `authenticate` has normalized
 * the request's tenant context against the live membership row.
 * Must be used AFTER `authenticate`.
 */
export function requireVerifiedRole(minRole: TenantRoleType) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const userRole = req.user?.tenantRole;
    if (!req.user?.tenantId || !userRole) {
      res.status(403).json({ error: 'Tenant membership required' });
      return;
    }

    if ((ROLE_HIERARCHY[userRole] ?? 0) < (ROLE_HIERARCHY[minRole] ?? Infinity)) {
      res.status(403).json({ error: 'Insufficient tenant role' });
      return;
    }

    next();
  };
}
