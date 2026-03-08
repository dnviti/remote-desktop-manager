import crypto from 'crypto';
import { Response } from 'express';
import { config } from '../config';

function parseExpiry(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const value = parseInt(match[1]);
  switch (match[2]) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return 7 * 24 * 60 * 60 * 1000;
  }
}

export function setRefreshTokenCookie(res: Response, refreshToken: string): void {
  res.cookie(config.cookie.refreshTokenName, refreshToken, {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    path: config.cookie.path,
    maxAge: parseExpiry(config.jwtRefreshExpiresIn),
  });
}

export function setCsrfCookie(res: Response): string {
  const csrfToken = crypto.randomBytes(32).toString('hex');
  res.cookie(config.cookie.csrfTokenName, csrfToken, {
    httpOnly: false,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    path: '/',
    maxAge: parseExpiry(config.jwtRefreshExpiresIn),
  });
  return csrfToken;
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(config.cookie.refreshTokenName, {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    path: config.cookie.path,
  });
  res.clearCookie(config.cookie.csrfTokenName, {
    httpOnly: false,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    path: '/',
  });
}
