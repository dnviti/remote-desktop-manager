import type { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { createRateLimiter } from './rateLimitFactory';

// --- OAuth flow limiter (public initiation, callback, providers list) ---
let _flowLimiter: ReturnType<typeof createRateLimiter> | null = null;
let _flowW = 0, _flowM = 0;

export function oauthFlowRateLimiter(req: Request, res: Response, next: NextFunction) {
  const w = config.oauthFlowRateLimitWindowMs, m = config.oauthFlowRateLimitMaxAttempts;
  if (!_flowLimiter || w !== _flowW || m !== _flowM) {
    _flowW = w; _flowM = m;
    _flowLimiter = createRateLimiter({ windowMs: w, max: m, message: 'Too many OAuth requests. Please try again later.' });
  }
  _flowLimiter(req, res, next);
}

// --- OAuth link limiter (account linking initiation) ---
let _linkLimiter: ReturnType<typeof createRateLimiter> | null = null;
let _linkW = 0, _linkM = 0;

export function oauthLinkRateLimiter(req: Request, res: Response, next: NextFunction) {
  const w = config.oauthLinkRateLimitWindowMs, m = config.oauthLinkRateLimitMaxAttempts;
  if (!_linkLimiter || w !== _linkW || m !== _linkM) {
    _linkW = w; _linkM = m;
    _linkLimiter = createRateLimiter({ windowMs: w, max: m, message: 'Too many account linking attempts. Please try again later.' });
  }
  _linkLimiter(req, res, next);
}

// --- OAuth account limiter (authenticated management routes) ---
let _acctLimiter: ReturnType<typeof createRateLimiter> | null = null;
let _acctW = 0, _acctM = 0;

export function oauthAccountRateLimiter(req: Request, res: Response, next: NextFunction) {
  const w = config.oauthAccountRateLimitWindowMs, m = config.oauthAccountRateLimitMaxAttempts;
  if (!_acctLimiter || w !== _acctW || m !== _acctM) {
    _acctW = w; _acctM = m;
    _acctLimiter = createRateLimiter({ windowMs: w, max: m, message: 'Too many OAuth account requests. Please try again later.', keyPrefix: 'oauth-account' });
  }
  _acctLimiter(req, res, next);
}
