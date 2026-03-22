import type { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { createRateLimiter } from './rateLimitFactory';

let _limiter: ReturnType<typeof createRateLimiter> | null = null;
let _windowMs = 0, _max = 0;

export function sessionRateLimiter(req: Request, res: Response, next: NextFunction) {
  const w = config.sessionRateLimitWindowMs, m = config.sessionRateLimitMaxAttempts;
  if (!_limiter || w !== _windowMs || m !== _max) {
    _windowMs = w; _max = m;
    _limiter = createRateLimiter({ windowMs: w, max: m, message: 'Too many session requests. Please try again later.', keyPrefix: 'session' });
  }
  _limiter(req, res, next);
}
