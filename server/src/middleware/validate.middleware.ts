import { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodSchema } from 'zod';
import { AppError } from './error.middleware';

type ValidateSource = 'body' | 'query' | 'params';

interface ValidateSchemaMap {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

function isSchemaMap(v: unknown): v is ValidateSchemaMap {
  return typeof v === 'object' && v !== null && !('safeParse' in v);
}

export function validate(schemas: ValidateSchemaMap): RequestHandler;
export function validate<T extends ZodSchema>(schema: T, source?: ValidateSource, errorMessage?: string): RequestHandler;
export function validate(
  schemaOrMap: ZodSchema | ValidateSchemaMap,
  source: ValidateSource = 'body',
  errorMessage?: string,
): RequestHandler {
  if (isSchemaMap(schemaOrMap)) {
    return (req: Request, _res: Response, next: NextFunction) => {
      const sources: ValidateSource[] = ['params', 'query', 'body'];
      for (const src of sources) {
        const schema = schemaOrMap[src];
        if (!schema) continue;
        const result = schema.safeParse(req[src]);
        if (!result.success) {
          return next(new AppError(result.error.issues[0].message, 400));
        }
        if (src === 'body') {
          req.body = result.data;
        } else {
          Object.defineProperty(req, src, { value: result.data, writable: true, configurable: true });
        }
      }
      next();
    };
  }

  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schemaOrMap.safeParse(req[source]);
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

/** Type-safe accessor for validated query params. Use only after validate() middleware. */
export function validatedQuery<T>(req: Request): T {
  return req.query as T;
}

/** Type-safe accessor for validated route params. Use only after validate() middleware. */
export function validatedParams<T>(req: Request): T {
  return req.params as T;
}
