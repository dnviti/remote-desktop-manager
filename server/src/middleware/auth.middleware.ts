import { Response, NextFunction } from 'express';
import { AuthPayload, AuthRequest, TenantRoleType } from '../types';
import { verifyJwt } from '../utils/jwt';
import { config } from '../config';
import { getClientIp } from '../utils/ip';
import { computeBindingHash } from '../utils/tokenBinding';
import * as auditService from '../services/audit.service';
import prisma from '../lib/prisma';

const ROLE_HIERARCHY: Record<string, number> = {
  GUEST:      0.1,
  AUDITOR:    0.3,
  CONSULTANT: 0.5,
  MEMBER:     1,
  OPERATOR:   2,
  ADMIN:      3,
  OWNER:      4,
};

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

    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Middleware that verifies the JWT-claimed role against the database.
 * Prevents privilege escalation via stale or forged JWT claims.
 * Must be used AFTER `authenticate`.
 */
export function requireVerifiedRole(minRole: TenantRoleType) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const user = req.user;
    if (!user?.userId || !user?.tenantId) {
      res.status(403).json({ error: 'Tenant membership required' });
      return;
    }

    const membership = await prisma.tenantMember.findUnique({
      where: { tenantId_userId: { tenantId: user.tenantId, userId: user.userId } },
      select: { role: true, expiresAt: true },
    });

    if (!membership) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // Reject expired memberships
    if (membership.expiresAt && membership.expiresAt < new Date()) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const dbRole = membership.role as string;
    if ((ROLE_HIERARCHY[dbRole] ?? 0) < (ROLE_HIERARCHY[minRole] ?? Infinity)) {
      res.status(403).json({ error: 'Insufficient tenant role' });
      return;
    }

    next();
  };
}
