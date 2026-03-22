import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import type { AuthPayload } from '../types';
import { config } from '../config';
import { isIpAllowed } from '../utils/ipAllowlist';
import { verifyJwt } from '../utils/jwt';

const env = (key: string, fallback: number) =>
  Number(process.env[key]) || fallback;

/**
 * Peek at the Authorization header to extract a userId for rate-limit keying.
 * Never throws — returns undefined if the token is missing, invalid, or expired.
 * This replaces the separate peekAuth middleware so CodeQL sees authorization
 * and rate limiting in a single handler.
 */
function peekUserId(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      return verifyJwt<AuthPayload>(authHeader.slice(7)).userId;
    } catch {
      // Token invalid/expired — treat as anonymous
    }
  }
  return undefined;
}

/**
 * Global API rate limiter applied to all /api routes.
 *
 * Tiers:
 * 1. Whitelisted IPs (loopback, RFC 1918 by default): skip rate limiting entirely
 * 2. Authenticated requests: keyed by userId (200 req / 60 s default)
 * 3. Unauthenticated requests: keyed by IP   (60 req / 60 s default)
 *
 * JWT peek is done inline (in keyGenerator/max) so that CodeQL sees
 * authorization and rate limiting in the same handler.
 *
 * Per-route limiters (login, vault, sessions, etc.) still apply on top
 * of this and are typically stricter.
 */
export const globalRateLimit = rateLimit({
  windowMs: env('GLOBAL_RATE_LIMIT_WINDOW_MS', 60_000),
  max: (req: Request) => {
    return peekUserId(req)
      ? env('GLOBAL_RATE_LIMIT_MAX_AUTHENTICATED', 200)
      : env('GLOBAL_RATE_LIMIT_MAX_ANONYMOUS', 60);
  },
  keyGenerator: (req: Request) => {
    const userId = peekUserId(req);
    if (userId) return `global:${userId}`;
    return `global:${ipKeyGenerator(req.ip ?? '127.0.0.1')}`;
  },
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  skip: (req: Request) => {
    // Never rate-limit health probes
    if (req.path === '/health' || req.path === '/ready') return true;
    // Skip whitelisted IPs (loopback + private ranges by default)
    const clientIp = req.ip ?? '127.0.0.1';
    if (config.rateLimitWhitelistCidrs.length > 0 &&
        isIpAllowed(clientIp, config.rateLimitWhitelistCidrs)) {
      return true;
    }
    return false;
  },
});
