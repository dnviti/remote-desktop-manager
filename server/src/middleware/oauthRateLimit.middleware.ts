import { config } from '../config';
import { createRateLimiter } from './rateLimitFactory';

/** Public OAuth initiation, callback, and providers list (IP-based). */
export const oauthFlowRateLimiter = createRateLimiter({
  windowMs: config.oauthFlowRateLimitWindowMs,
  max: config.oauthFlowRateLimitMaxAttempts,
  message: 'Too many OAuth requests. Please try again later.',
});

/** Account linking initiation — IP-based, tighter limit for sensitive action. */
export const oauthLinkRateLimiter = createRateLimiter({
  windowMs: config.oauthLinkRateLimitWindowMs,
  max: config.oauthLinkRateLimitMaxAttempts,
  message: 'Too many account linking attempts. Please try again later.',
});

/** Authenticated OAuth management routes (userId-based). */
export const oauthAccountRateLimiter = createRateLimiter({
  windowMs: config.oauthAccountRateLimitWindowMs,
  max: config.oauthAccountRateLimitMaxAttempts,
  message: 'Too many OAuth account requests. Please try again later.',
  keyPrefix: 'oauth-account',
});
