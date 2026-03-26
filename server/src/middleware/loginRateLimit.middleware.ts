import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { config } from '../config';
import { createRateLimiter } from './rateLimitFactory';
import prisma from '../lib/prisma';
import { logger } from '../utils/logger';

let _globalLimiter = createRateLimiter({
  windowMs: config.loginRateLimitWindowMs,
  max: config.loginRateLimitMaxAttempts,
  message: 'Too many login attempts. Please try again later.',
});

const _tenantLimiters = new Map<string, RequestHandler>();

function getOrCreateTenantLimiter(tenantId: string, windowMs: number, max: number): RequestHandler {
  const key = `${tenantId}:${windowMs}:${max}`;
  let limiter = _tenantLimiters.get(key);
  if (!limiter) {
    limiter = createRateLimiter({
      windowMs,
      max,
      message: 'Too many login attempts. Please try again later.',
    });
    _tenantLimiters.set(key, limiter);
  }
  return limiter;
}

export function loginRateLimiter(req: Request, res: Response, next: NextFunction) {
  const email = req.body?.email;
  if (!email || typeof email !== 'string') {
    return _globalLimiter(req, res, next);
  }

  resolveTenantLimiter(email)
    .then((limiter) => limiter(req, res, next))
    .catch((err) => {
      logger.warn('Tenant rate limit lookup failed, using global limiter:', err instanceof Error ? err.message : 'Unknown error');
      _globalLimiter(req, res, next);
    });
}

async function resolveTenantLimiter(email: string): Promise<RequestHandler> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      tenantMemberships: {
        where: { isActive: true },
        take: 1,
        include: { tenant: { select: { id: true, loginRateLimitWindowMs: true, loginRateLimitMaxAttempts: true } } },
      },
    },
  });

  const tenant = user?.tenantMemberships[0]?.tenant;
  if (tenant?.loginRateLimitWindowMs != null && tenant?.loginRateLimitMaxAttempts != null) {
    return getOrCreateTenantLimiter(tenant.id, tenant.loginRateLimitWindowMs, tenant.loginRateLimitMaxAttempts);
  }

  return _globalLimiter;
}

/** Rebuild login rate limiter with current config values. */
export function rebuildLoginRateLimiter(): void {
  _globalLimiter = createRateLimiter({
    windowMs: config.loginRateLimitWindowMs,
    max: config.loginRateLimitMaxAttempts,
    message: 'Too many login attempts. Please try again later.',
  });
  _tenantLimiters.clear();
}
