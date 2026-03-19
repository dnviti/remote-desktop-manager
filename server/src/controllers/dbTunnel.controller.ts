import { Response, NextFunction } from 'express';
import { AuthRequest, assertAuthenticated } from '../types';
import { getConnection, getConnectionCredentials } from '../services/connection.service';
import * as dbTunnelService from '../services/dbTunnel.service';
import * as sessionService from '../services/session.service';
import * as auditService from '../services/audit.service';
import { AppError } from '../middleware/error.middleware';
import { getClientIp } from '../utils/ip';
import type { DbTunnelInput } from '../schemas/dbTunnel.schemas';

/**
 * POST /api/sessions/db-tunnel
 * Opens an SSH tunnel to a database through a bastion host.
 */
export async function createDbTunnel(req: AuthRequest, res: Response, next: NextFunction) {
  let connectionId: string | undefined;

  try {
    assertAuthenticated(req);
    const parsed = req.body as DbTunnelInput;
    connectionId = parsed.connectionId;

    const conn = await getConnection(req.user.userId, connectionId, req.user.tenantId);

    if (conn.type !== 'DB_TUNNEL') {
      throw new AppError('Not a DB_TUNNEL connection', 400);
    }

    // The connection's host/port represents the bastion
    const bastionHost = conn.host;
    const bastionPort = conn.port;

    // Target DB fields are stored on the connection
    const connAny = conn as typeof conn & {
      targetDbHost?: string | null;
      targetDbPort?: number | null;
      dbType?: string | null;
      bastionConnectionId?: string | null;
    };
    const targetDbHost = connAny.targetDbHost;
    const targetDbPort = connAny.targetDbPort;

    if (!targetDbHost || !targetDbPort) {
      throw new AppError('Target database host and port are required', 400);
    }

    // Resolve bastion credentials from the connection's stored credentials
    const bastionCreds = await getConnectionCredentials(req.user.userId, connectionId, req.user.tenantId);

    // DB credentials from request body (injected from vault on client side)
    const dbUsername = parsed.dbUsername;
    const dbPassword = parsed.dbPassword;
    const dbName = parsed.dbName;
    const dbType = connAny.dbType ?? parsed.dbType ?? undefined;

    const tunnel = await dbTunnelService.openTunnel({
      bastionHost,
      bastionPort,
      bastionUsername: bastionCreds.username,
      bastionPassword: bastionCreds.password,
      bastionPrivateKey: bastionCreds.privateKey,
      bastionPassphrase: bastionCreds.passphrase,
      targetDbHost,
      targetDbPort,
      dbUsername,
      dbPassword,
      dbName,
      dbType,
      userId: req.user.userId,
      connectionId,
      ipAddress: getClientIp(req) ?? undefined,
    });

    // Create a persistent session record
    const sessionId = await sessionService.startSession({
      userId: req.user.userId,
      connectionId,
      protocol: 'DB_TUNNEL',
      ipAddress: getClientIp(req) ?? undefined,
      metadata: {
        tunnelId: tunnel.id,
        localPort: tunnel.localPort,
        targetDbHost,
        targetDbPort,
        dbType,
      },
    });

    res.json({
      tunnelId: tunnel.id,
      sessionId,
      localHost: '127.0.0.1',
      localPort: tunnel.localPort,
      connectionString: tunnel.connectionString ?? null,
      targetDbHost,
      targetDbPort,
      dbType: dbType ?? null,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    auditService.log({
      userId: req.user?.userId,
      action: 'DB_TUNNEL_ERROR',
      targetType: 'Connection',
      targetId: connectionId,
      details: {
        protocol: 'DB_TUNNEL',
        error: errorMessage,
      },
      ipAddress: getClientIp(req),
    });

    next(err);
  }
}

/**
 * DELETE /api/sessions/db-tunnel/:tunnelId
 * Closes an active DB tunnel.
 */
export async function closeDbTunnel(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const tunnelId = req.params.tunnelId as string;

  const tunnel = dbTunnelService.getTunnel(tunnelId);
  if (!tunnel || tunnel.userId !== req.user.userId) {
    throw new AppError('Tunnel not found', 404);
  }

  dbTunnelService.closeTunnel(tunnelId);
  res.json({ ok: true });
}

/**
 * GET /api/sessions/db-tunnel
 * Lists active DB tunnels for the current user.
 */
export async function listDbTunnels(req: AuthRequest, res: Response) {
  assertAuthenticated(req);

  const tunnels = dbTunnelService.getUserTunnels(req.user.userId);

  res.json(
    tunnels.map((t) => ({
      tunnelId: t.id,
      localHost: '127.0.0.1',
      localPort: t.localPort,
      targetDbHost: t.targetDbHost,
      targetDbPort: t.targetDbPort,
      dbType: t.dbType ?? null,
      connectionString: t.connectionString ?? null,
      connectionId: t.connectionId,
      healthy: t.healthy,
      createdAt: t.createdAt.toISOString(),
    })),
  );
}

/**
 * POST /api/sessions/db-tunnel/:tunnelId/heartbeat
 * Heartbeat for a DB tunnel session.
 */
export async function dbTunnelHeartbeat(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const tunnelId = req.params.tunnelId as string;

  const tunnel = dbTunnelService.getTunnel(tunnelId);
  if (!tunnel || tunnel.userId !== req.user.userId) {
    throw new AppError('Tunnel not found', 404);
  }

  res.json({ ok: true, healthy: tunnel.healthy });
}
