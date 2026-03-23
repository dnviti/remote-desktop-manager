import { Response, NextFunction } from 'express';
import { AuthRequest, assertAuthenticated } from '../types';
import type { AuthRequest as AuthRequestType } from '../types';
import { AppError } from '../middleware/error.middleware';
import * as aiQueryService from '../services/aiQuery.service';
import * as tenantAiConfigService from '../services/tenantAiConfig.service';
import * as dbSessionService from '../services/dbSession.service';
import { getClientIp } from '../utils/ip';

// ---- AI Query Generation (AISQL-2069) ----

/** Known database protocols — used to validate client-supplied dbProtocol values. */
const KNOWN_DB_PROTOCOLS = new Set([
  'postgresql', 'mysql', 'mongodb', 'oracle', 'mssql', 'db2',
]);

/**
 * GET /api/ai/config — Returns tenant AI config (API key redacted).
 * Requires ADMIN or OWNER (enforced by route middleware).
 */
export async function getConfig(req: AuthRequestType, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId!;
  const cfg = await tenantAiConfigService.getConfig(tenantId);
  res.json(cfg);
}

/**
 * PUT /api/ai/config — Updates tenant AI config.
 * Requires OWNER (enforced by route middleware).
 */
export async function updateConfig(req: AuthRequestType, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId!;
  const { provider, apiKey, modelId, baseUrl, maxTokensPerRequest, dailyRequestLimit, enabled } = req.body as {
    provider?: string;
    apiKey?: string;
    modelId?: string;
    baseUrl?: string;
    maxTokensPerRequest?: number;
    dailyRequestLimit?: number;
    enabled?: boolean;
  };

  if (provider !== undefined && !['none', 'anthropic', 'openai', 'ollama', 'openai-compatible'].includes(provider)) {
    throw new AppError('Invalid provider. Must be "none", "anthropic", "openai", "ollama", or "openai-compatible".', 400);
  }

  const cfg = await tenantAiConfigService.upsertConfig(tenantId, {
    provider,
    apiKey,
    modelId,
    baseUrl,
    maxTokensPerRequest,
    dailyRequestLimit,
    enabled,
  });

  res.json(cfg);
}

/**
 * POST /api/ai/generate-query — Analyze prompt and return needed tables for approval.
 * Requires authenticated user with a tenant (enforced by route middleware).
 */
export async function analyzeQuery(req: AuthRequestType, res: Response): Promise<void> {
  const { prompt, sessionId, dbProtocol: clientProtocol } = req.body as {
    prompt?: string;
    sessionId?: string;
    dbProtocol?: string;
  };

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    throw new AppError('Prompt is required', 400);
  }

  if (!sessionId || typeof sessionId !== 'string') {
    throw new AppError('Session ID is required', 400);
  }

  if (prompt.length > 2000) {
    throw new AppError('Prompt must be 2000 characters or fewer', 400);
  }

  const userId = req.user!.userId;
  const tenantId = req.user!.tenantId;
  if (!tenantId) {
    throw new AppError('Tenant membership required', 403);
  }

  // Fetch the schema from the active DB session
  let schema: dbSessionService.TableInfo[] = [];
  try {
    const schemaInfo = await dbSessionService.getSchema(userId, sessionId, tenantId);
    schema = schemaInfo.tables;
  } catch {
    // Schema fetch is best-effort; we proceed without it
  }

  const dbProtocol = clientProtocol && KNOWN_DB_PROTOCOLS.has(clientProtocol)
    ? clientProtocol
    : 'postgresql';

  const result = await aiQueryService.analyzeQueryIntent({
    tenantId,
    userId,
    prompt: prompt.trim(),
    schema,
    dbProtocol,
    ipAddress: req.ip,
  });

  res.json(result);
}

/**
 * POST /api/ai/generate-query/confirm — Generate SQL with approved tables.
 * Requires authenticated user with a tenant (enforced by route middleware).
 */
export async function confirmGeneration(req: AuthRequestType, res: Response): Promise<void> {
  const { conversationId, approvedObjects } = req.body as {
    conversationId?: string;
    approvedObjects?: string[];
  };

  if (!conversationId || typeof conversationId !== 'string') {
    throw new AppError('conversationId is required', 400);
  }

  if (!approvedObjects || !Array.isArray(approvedObjects) || approvedObjects.length === 0) {
    throw new AppError('approvedObjects must be a non-empty array of table names', 400);
  }

  const userId = req.user!.userId;
  const tenantId = req.user!.tenantId;
  if (!tenantId) {
    throw new AppError('Tenant membership required', 403);
  }

  const result = await aiQueryService.confirmAndGenerate(
    conversationId,
    approvedObjects,
    userId,
    tenantId,
    req.ip,
  );

  res.json(result);
}

// ---- AI Query Optimization (SQLVIZ-2070) ----

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
    if (!KNOWN_DB_PROTOCOLS.has(dbProtocol)) {
      throw new AppError(`Unsupported dbProtocol "${dbProtocol}". Must be one of: ${[...KNOWN_DB_PROTOCOLS].join(', ')}`, 400);
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
