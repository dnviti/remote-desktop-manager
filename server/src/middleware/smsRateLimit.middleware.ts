import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

export const smsRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 3,
  message: { error: 'Too many SMS requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const authReq = req as { user?: { userId: string } };
    if (authReq.user?.userId) return `sms:${authReq.user.userId}`;
    return `sms:${ipKeyGenerator(req.ip ?? '127.0.0.1')}`;
  },
});

export const smsLoginRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  message: { error: 'Too many SMS requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
