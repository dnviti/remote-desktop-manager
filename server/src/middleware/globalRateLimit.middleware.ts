import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import type { AuthRequest } from '../types';

const env = (key: string, fallback: number) =>
  Number(process.env[key]) || fallback;

/**
 * Global API rate limiter applied to all /api routes.
 *
 * - Authenticated requests: keyed by userId (200 req / 60 s default)
 * - Unauthenticated requests: keyed by IP   (60 req / 60 s default)
 *
 * Per-route limiters (login, vault, sessions, etc.) still apply on top
 * of this and are typically stricter.
 */
export const globalRateLimit = rateLimit({
  windowMs: env('GLOBAL_RATE_LIMIT_WINDOW_MS', 60_000),
  max: (req: Request) => {
    const authReq = req as AuthRequest;
    return authReq.user?.userId
      ? env('GLOBAL_RATE_LIMIT_MAX_AUTHENTICATED', 200)
      : env('GLOBAL_RATE_LIMIT_MAX_ANONYMOUS', 60);
  },
  keyGenerator: (req: Request) => {
    const authReq = req as AuthRequest;
    if (authReq.user?.userId) return `global:${authReq.user.userId}`;
    return `global:${ipKeyGenerator(req.ip ?? '127.0.0.1')}`;
  },
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  // Never rate-limit health probes
  skip: (req: Request) => req.path === '/health' || req.path === '/ready',
});
