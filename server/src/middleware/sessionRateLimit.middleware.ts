import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { config } from '../config';

export const sessionRateLimiter = rateLimit({
  windowMs: config.sessionRateLimitWindowMs,
  max: config.sessionRateLimitMaxAttempts,
  message: { error: 'Too many session requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const authReq = req as { user?: { userId: string } };
    if (authReq.user?.userId) return `session:${authReq.user.userId}`;
    return `session:${ipKeyGenerator(req.ip ?? '127.0.0.1')}`;
  },
});
