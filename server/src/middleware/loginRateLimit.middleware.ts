import type { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { createRateLimiter } from './rateLimitFactory';

let _limiter: ReturnType<typeof createRateLimiter> | null = null;
let _windowMs = 0;
let _max = 0;

export function loginRateLimiter(req: Request, res: Response, next: NextFunction) {
  const wMs = config.loginRateLimitWindowMs;
  const mx = config.loginRateLimitMaxAttempts;
  if (!_limiter || wMs !== _windowMs || mx !== _max) {
    _windowMs = wMs;
    _max = mx;
    _limiter = createRateLimiter({
      windowMs: wMs,
      max: mx,
      message: 'Too many login attempts. Please try again later.',
    });
  }
  _limiter(req, res, next);
}
