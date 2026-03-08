import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

export function validateCsrf(req: Request, res: Response, next: NextFunction): void {
  const headerToken = req.headers['x-csrf-token'] as string | undefined;
  const cookieToken = req.cookies?.[config.cookie.csrfTokenName] as string | undefined;

  if (!headerToken || !cookieToken) {
    res.status(403).json({ error: 'CSRF token missing' });
    return;
  }

  const headerBuf = Buffer.from(headerToken);
  const cookieBuf = Buffer.from(cookieToken);

  if (headerBuf.length !== cookieBuf.length || !crypto.timingSafeEqual(headerBuf, cookieBuf)) {
    res.status(403).json({ error: 'CSRF token mismatch' });
    return;
  }

  next();
}
