import rateLimit from 'express-rate-limit';

export const identityVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3,
  message: { error: 'Too many verification requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  // Keyed by authenticated userId (this runs after authenticate middleware).
  // The IP fallback is a safety net — suppress the IPv6 validation warning.
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => {
    const authReq = req as { user?: { userId: string } };
    return authReq.user?.userId ?? req.ip ?? '127.0.0.1';
  },
});
