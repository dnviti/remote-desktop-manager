import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

const log = logger.child('http');

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const contentLength = res.getHeader('content-length') ?? '-';
    const msg = `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms ${contentLength}`;

    if (res.statusCode >= 500) {
      log.error(msg);
    } else if (res.statusCode >= 400) {
      log.warn(msg);
    } else {
      log.verbose(msg);
    }
  });

  next();
}
