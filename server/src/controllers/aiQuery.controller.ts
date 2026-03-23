import { Response } from 'express';
import type { AuthRequest } from '../types';
import { AppError } from '../middleware/error.middleware';
import * as aiQueryService from '../services/aiQuery.service';
import * as tenantAiConfigService from '../services/tenantAiConfig.service';
import * as dbSessionService from '../services/dbSession.service';

/**
 * GET /api/ai/config — Returns tenant AI config (API key redacted).
 * Requires ADMIN or OWNER (enforced by route middleware).
 */
export async function getConfig(req: AuthRequest, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId!;
  const cfg = await tenantAiConfigService.getConfig(tenantId);
  res.json(cfg);
}

/**
 * PUT /api/ai/config — Updates tenant AI config.
 * Requires OWNER (enforced by route middleware).
 */
export async function updateConfig(req: AuthRequest, res: Response): Promise<void> {
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

  if (provider !== undefined && !['none', 'anthropic', 'openai'].includes(provider)) {
    throw new AppError('Invalid provider. Must be "none", "anthropic", or "openai".', 400);
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
 * POST /api/ai/generate-query — Generate SQL from natural language.
 * Requires authenticated user with a tenant (enforced by route middleware).
 */
export async function generateQuery(req: AuthRequest, res: Response): Promise<void> {
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

  const dbProtocol = clientProtocol || 'postgresql';

  const result = await aiQueryService.generateSqlFromPrompt({
    tenantId,
    userId,
    prompt: prompt.trim(),
    schema,
    dbProtocol,
    ipAddress: req.ip,
  });

  res.json(result);
}
