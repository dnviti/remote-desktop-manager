import { Response, NextFunction } from 'express';
import { AuthRequest, assertAuthenticated } from '../types';
import { getConnection } from '../services/connection.service';
import * as dbSessionService from '../services/dbSession.service';
import * as auditService from '../services/audit.service';
import { AppError } from '../middleware/error.middleware';
import { getClientIp } from '../utils/ip';

// ---- Database proxy session creation ----

export async function createSession(req: AuthRequest, res: Response, next: NextFunction) {
  let connectionId: string | undefined;

  try {
    assertAuthenticated(req);
    const { connectionId: connId, username, password, sessionConfig } = req.body as {
      connectionId: string;
      username?: string;
      password?: string;
      sessionConfig?: import('../types').DbSessionConfig;
    };
    connectionId = connId;

    if (!connectionId) {
      throw new AppError('connectionId is required', 400);
    }

    // Validate the user can access this connection
    const conn = await getConnection(req.user.userId, connectionId, req.user.tenantId);
    if (conn.type !== 'DATABASE') {
      throw new AppError('Not a DATABASE connection', 400);
    }

    const result = await dbSessionService.createSession({
      userId: req.user.userId,
      connectionId,
      tenantId: req.user.tenantId,
      ipAddress: getClientIp(req) ?? undefined,
      overrideUsername: username,
      overridePassword: password,
      sessionConfig,
    });

    res.json(result);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    auditService.log({
      userId: req.user?.userId,
      action: 'SESSION_ERROR',
      targetType: 'Connection',
      targetId: connectionId,
      details: { protocol: 'DATABASE', error: errorMessage },
      ipAddress: getClientIp(req),
    });
    next(err);
  }
}

// ---- Database proxy session end ----

export async function endSession(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const sessionId = req.params.sessionId as string;
  await dbSessionService.endSession(req.user.userId, sessionId);
  res.json({ ok: true });
}

// ---- Database session heartbeat ----

export async function heartbeat(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const sessionId = req.params.sessionId as string;
  await dbSessionService.heartbeat(sessionId, req.user.userId);
  res.json({ ok: true });
}

// ---- Execute SQL query ----

export async function executeQuery(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const sessionId = req.params.sessionId as string;
    const { sql } = req.body as { sql: string };

    if (!sql || typeof sql !== 'string') {
      throw new AppError('sql is required', 400);
    }

    // tenantId is guaranteed by requireTenant middleware on this route
    const tenantId = req.user.tenantId as string;

    const result = await dbSessionService.executeQuery({
      userId: req.user.userId,
      tenantId,
      tenantRole: req.user.tenantRole,
      sessionId,
      sql,
      ipAddress: getClientIp(req) ?? undefined,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ---- Get database schema ----

export async function getSchema(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const sessionId = req.params.sessionId as string;
    const tenantId = req.user.tenantId as string;
    const schema = await dbSessionService.getSchema(req.user.userId, sessionId, tenantId);
    res.json(schema);
  } catch (err) {
    next(err);
  }
}

// ---- Get execution plan (EXPLAIN) ----

export async function getExecutionPlan(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const sessionId = req.params.sessionId as string;
    const { sql } = req.body as { sql: string };

    if (!sql || typeof sql !== 'string') {
      throw new AppError('sql is required', 400);
    }

    const tenantId = req.user.tenantId as string;
    const result = await dbSessionService.getExecutionPlan({
      userId: req.user.userId,
      tenantId,
      tenantRole: req.user.tenantRole,
      sessionId,
      sql,
      ipAddress: getClientIp(req) ?? undefined,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ---- Database introspection ----

const VALID_INTROSPECTION_TYPES = new Set([
  'indexes', 'statistics', 'foreign_keys', 'table_schema', 'row_count', 'database_version',
]);

export async function introspectDatabase(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const sessionId = req.params.sessionId as string;
    const { type, target } = req.body as { type: string; target?: string };

    if (!type || typeof type !== 'string') {
      throw new AppError('type is required', 400);
    }
    if (!VALID_INTROSPECTION_TYPES.has(type)) {
      throw new AppError(`Invalid introspection type: ${type}`, 400);
    }
    // target is required for all types except database_version
    if (type !== 'database_version' && (!target || typeof target !== 'string')) {
      throw new AppError('target is required for this introspection type', 400);
    }

    const tenantId = req.user.tenantId as string;
    const result = await dbSessionService.introspectDatabase({
      userId: req.user.userId,
      tenantId,
      tenantRole: req.user.tenantRole,
      sessionId,
      type: type as Parameters<typeof dbSessionService.introspectDatabase>[0]['type'],
      target: target ?? '',
      ipAddress: getClientIp(req) ?? undefined,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ---- Session configuration ----

export async function updateSessionConfig(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const sessionId = req.params.sessionId as string;
    const { sessionConfig } = req.body as { sessionConfig?: import('../types').DbSessionConfig };

    if (!sessionConfig || typeof sessionConfig !== 'object') {
      throw new AppError('sessionConfig is required', 400);
    }

    // Input length validation
    if (sessionConfig.timezone && (typeof sessionConfig.timezone !== 'string' || sessionConfig.timezone.length > 100)) {
      throw new AppError('timezone must be a string with max 100 characters', 400);
    }
    if (sessionConfig.searchPath && (typeof sessionConfig.searchPath !== 'string' || sessionConfig.searchPath.length > 500)) {
      throw new AppError('searchPath must be a string with max 500 characters', 400);
    }
    if (sessionConfig.activeDatabase && (typeof sessionConfig.activeDatabase !== 'string' || sessionConfig.activeDatabase.length > 128)) {
      throw new AppError('activeDatabase must be a string with max 128 characters', 400);
    }
    if (sessionConfig.encoding && (typeof sessionConfig.encoding !== 'string' || sessionConfig.encoding.length > 50)) {
      throw new AppError('encoding must be a string with max 50 characters', 400);
    }
    if (sessionConfig.initCommands) {
      if (!Array.isArray(sessionConfig.initCommands) || sessionConfig.initCommands.length > 10) {
        throw new AppError('initCommands must be an array with max 10 entries', 400);
      }
      for (const cmd of sessionConfig.initCommands) {
        if (typeof cmd !== 'string' || cmd.length > 500) {
          throw new AppError('Each init command must be a string with max 500 characters', 400);
        }
      }
    }

    const tenantId = req.user.tenantId as string;
    const result = await dbSessionService.updateSessionConfig({
      userId: req.user.userId,
      tenantId,
      tenantRole: req.user.tenantRole,
      sessionId,
      sessionConfig,
      ipAddress: getClientIp(req) ?? undefined,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getSessionConfig(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const sessionId = req.params.sessionId as string;
    const sessionConfig = await dbSessionService.getSessionConfig(req.user.userId, sessionId);
    res.json(sessionConfig);
  } catch (err) {
    next(err);
  }
}

// ---- Query history ----

export async function getQueryHistory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const sessionId = req.params.sessionId as string;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const search = (req.query.search as string) || undefined;

    const history = await dbSessionService.getQueryHistory({
      userId: req.user.userId,
      sessionId,
      limit,
      search,
    });

    res.json(history);
  } catch (err) {
    next(err);
  }
}
