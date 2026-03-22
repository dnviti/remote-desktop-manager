vi.mock('../utils/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

import { Request, Response, NextFunction } from 'express';
import { AppError, errorHandler } from './error.middleware';
import { logger } from '../utils/logger';

function createMocks() {
  const req = {} as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next: NextFunction = vi.fn();

  return { req, res, next };
}

describe('AppError', () => {
  it('sets message and statusCode via constructor', () => {
    const err = new AppError('Not found', 404);

    expect(err.message).toBe('Not found');
    expect(err.statusCode).toBe(404);
  });

  it('is an instance of Error', () => {
    const err = new AppError('Bad request', 400);

    expect(err).toBeInstanceOf(Error);
  });
});

describe('errorHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the correct status and message for an AppError', () => {
    const { req, res, next } = createMocks();
    const err = new AppError('Forbidden', 403);

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden' });
  });

  it('returns 500 "Internal server error" for a generic Error', () => {
    const { req, res, next } = createMocks();
    const err = new Error('something broke');

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' });
  });

  it('logs generic errors via logger.error', () => {
    const { req, res, next } = createMocks();
    const err = new Error('unexpected failure');

    errorHandler(err, req, res, next);

    expect(logger.error).toHaveBeenCalledWith('Unhandled error:', err.message);
  });
});
