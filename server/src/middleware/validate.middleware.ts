import { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodSchema } from 'zod';
import { AppError } from './error.middleware';

type ValidateSource = 'body' | 'query' | 'params';

export function validate<T extends ZodSchema>(
  schema: T,
  source: ValidateSource = 'body',
  errorMessage?: string,
): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const message = errorMessage ?? result.error.issues[0].message;
      return next(new AppError(message, 400));
    }
    if (source === 'body') {
      req.body = result.data;
    } else {
      Object.defineProperty(req, source, { value: result.data, writable: true, configurable: true });
    }
    next();
  };
}

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateUuidParam(paramName = 'id'): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const value = req.params[paramName] as string | undefined;
    if (!value || !uuidRegex.test(value)) {
      return next(new AppError(`Invalid ${paramName}`, 400));
    }
    next();
  };
}
