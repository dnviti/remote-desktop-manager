import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { config } from '../config';

export const vaultUnlockRateLimiter = rateLimit({
  windowMs: config.vaultRateLimitWindowMs,
  max: config.vaultRateLimitMaxAttempts,
  message: { error: 'Too many vault unlock attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const authReq = req as { user?: { userId: string } };
    if (authReq.user?.userId) return `vault:${authReq.user.userId}`;
    return `vault:${ipKeyGenerator(req.ip ?? '127.0.0.1')}`;
  },
});

export const vaultMfaRateLimiter = rateLimit({
  windowMs: config.vaultRateLimitWindowMs,
  max: config.vaultMfaRateLimitMaxAttempts,
  message: { error: 'Too many vault unlock attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const authReq = req as { user?: { userId: string } };
    if (authReq.user?.userId) return `vault-mfa:${authReq.user.userId}`;
    return `vault-mfa:${ipKeyGenerator(req.ip ?? '127.0.0.1')}`;
  },
});
