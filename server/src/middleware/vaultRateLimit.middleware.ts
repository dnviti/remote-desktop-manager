import type { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { createRateLimiter } from './rateLimitFactory';

// --- Vault unlock limiter ---
let _unlockLimiter: ReturnType<typeof createRateLimiter> | null = null;
let _unlockW = 0, _unlockM = 0;

export function vaultUnlockRateLimiter(req: Request, res: Response, next: NextFunction) {
  const w = config.vaultRateLimitWindowMs, m = config.vaultRateLimitMaxAttempts;
  if (!_unlockLimiter || w !== _unlockW || m !== _unlockM) {
    _unlockW = w; _unlockM = m;
    _unlockLimiter = createRateLimiter({ windowMs: w, max: m, message: 'Too many vault unlock attempts. Please try again later.', keyPrefix: 'vault' });
  }
  _unlockLimiter(req, res, next);
}

// --- Vault MFA limiter ---
let _mfaLimiter: ReturnType<typeof createRateLimiter> | null = null;
let _mfaW = 0, _mfaM = 0;

export function vaultMfaRateLimiter(req: Request, res: Response, next: NextFunction) {
  const w = config.vaultRateLimitWindowMs, m = config.vaultMfaRateLimitMaxAttempts;
  if (!_mfaLimiter || w !== _mfaW || m !== _mfaM) {
    _mfaW = w; _mfaM = m;
    _mfaLimiter = createRateLimiter({ windowMs: w, max: m, message: 'Too many vault unlock attempts. Please try again later.', keyPrefix: 'vault-mfa' });
  }
  _mfaLimiter(req, res, next);
}
