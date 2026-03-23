import { Response, NextFunction } from 'express';
import { AuthRequest, assertAuthenticated } from '../types';
import * as aiQueryService from '../services/aiQuery.service';
import { AppError } from '../middleware/error.middleware';
import { getClientIp } from '../utils/ip';

// ---- Optimize query (initial request) ----

export async function optimizeQuery(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { sql, executionPlan, sessionId, dbProtocol, dbVersion, schemaContext } = req.body as {
      sql: string;
      executionPlan: unknown;
      sessionId: string;
      dbProtocol: string;
      dbVersion?: string;
      schemaContext?: unknown;
    };

    if (!sql || typeof sql !== 'string') {
      throw new AppError('sql is required', 400);
    }
    if (!sessionId || typeof sessionId !== 'string') {
      throw new AppError('sessionId is required', 400);
    }
    if (!dbProtocol || typeof dbProtocol !== 'string') {
      throw new AppError('dbProtocol is required', 400);
    }

    const tenantId = req.user.tenantId as string;
    const result = await aiQueryService.optimizeQuery(
      { sql, executionPlan, sessionId, dbProtocol, dbVersion, schemaContext },
      req.user.userId,
      tenantId,
      getClientIp(req) ?? undefined,
    );

    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ---- Continue optimization (follow-up with approved data) ----

export async function continueOptimization(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { conversationId, approvedData } = req.body as {
      conversationId: string;
      approvedData: Record<string, unknown>;
    };

    if (!conversationId || typeof conversationId !== 'string') {
      throw new AppError('conversationId is required', 400);
    }
    if (!approvedData || typeof approvedData !== 'object') {
      throw new AppError('approvedData is required', 400);
    }

    const tenantId = req.user.tenantId as string;
    const result = await aiQueryService.continueOptimization(
      conversationId,
      approvedData,
      req.user.userId,
      tenantId,
      getClientIp(req) ?? undefined,
    );

    res.json(result);
  } catch (err) {
    next(err);
  }
}
