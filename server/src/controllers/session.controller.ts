import { Response, NextFunction } from 'express';
import path from 'path';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { AuthRequest, RdpSettings } from '../types';
import { getConnection, getConnectionCredentials } from '../services/connection.service';
import { generateGuacamoleToken, mergeRdpSettings } from '../services/rdp.service';
import * as sessionService from '../services/session.service';
import * as auditService from '../services/audit.service';
import { selectInstance } from '../services/loadBalancer.service';
import { AppError } from '../middleware/error.middleware';

const sessionSchema = z.object({
  connectionId: z.string().uuid(),
  username: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
}).refine(
  (data) => (!data.username && !data.password) || (data.username && data.password),
  { message: 'Both username and password must be provided together' },
);

// ---- RDP session creation (migrated from rdp.handler.ts) ----

export async function createRdpSession(req: AuthRequest, res: Response, next: NextFunction) {
  // Capture context progressively so we can log whatever is available on failure
  let connectionId: string | undefined;
  let connHost: string | undefined;
  let connPort: number | undefined;
  let gatewayId: string | null | undefined;

  try {
    const parsed = sessionSchema.parse(req.body);
    connectionId = parsed.connectionId;
    const { username: overrideUser, password: overridePass } = parsed;

    const conn = await getConnection(req.user!.userId, connectionId, req.user!.tenantId);
    connHost = conn.host;
    connPort = conn.port;
    gatewayId = conn.gatewayId;

    if (conn.type !== 'RDP') {
      throw new AppError('Not an RDP connection', 400);
    }

    // Resolve gateway for dynamic guacd routing
    let guacdHost: string | undefined;
    let guacdPort: number | undefined;
    let selectedInstanceId: string | undefined;
    let routingDecision: { strategy: string; candidateCount: number; selectedSessionCount: number } | undefined;

    if (conn.gateway) {
      if (conn.gateway.type !== 'GUACD') {
        throw new AppError('Connection gateway must be of type GUACD for RDP connections', 400);
      }
      guacdHost = conn.gateway.host;
      guacdPort = conn.gateway.port;

      if (conn.gateway.isManaged) {
        const inst = await selectInstance(conn.gateway.id, conn.gateway.lbStrategy);
        if (!inst) {
          throw new AppError(
            'No healthy gateway instances available. The gateway may be scaling — please try again.',
            503,
          );
        }
        guacdHost = inst.host;
        guacdPort = inst.port;
        selectedInstanceId = inst.id;
        routingDecision = {
          strategy: inst.strategy,
          candidateCount: inst.candidateCount,
          selectedSessionCount: inst.selectedSessionCount,
        };
      }
    }

    let username: string;
    let password: string;
    if (overrideUser && overridePass) {
      username = overrideUser;
      password = overridePass;
    } else {
      const creds = await getConnectionCredentials(req.user!.userId, connectionId, req.user!.tenantId);
      if (creds.privateKey && !creds.password) {
        throw new AppError('SSH key authentication is not supported for RDP connections', 400);
      }
      username = creds.username;
      password = creds.password;
    }

    // Load user RDP defaults and connection RDP settings, then merge
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { rdpDefaults: true },
    });
    const userRdpDefaults = (user?.rdpDefaults as Partial<RdpSettings>) ?? null;
    const connRdpSettings = (conn.rdpSettings as Partial<RdpSettings>) ?? null;
    const mergedRdp = mergeRdpSettings(userRdpDefaults, connRdpSettings);

    const enableDrive = conn.enableDrive ?? false;
    const drivePath = enableDrive
      ? path.posix.join('/guacd-drive', req.user!.userId)
      : undefined;

    const token = generateGuacamoleToken({
      host: conn.host,
      port: conn.port,
      username,
      password,
      enableDrive,
      drivePath,
      rdpSettings: mergedRdp,
      guacdHost,
      guacdPort,
      metadata: {
        userId: req.user!.userId,
        connectionId,
        ipAddress: req.ip ?? undefined,
      },
    });

    // Create persistent session record
    const sessionId = await sessionService.startSession({
      userId: req.user!.userId,
      connectionId,
      gatewayId: conn.gatewayId ?? undefined,
      instanceId: selectedInstanceId,
      protocol: 'RDP',
      guacToken: token,
      ipAddress: req.ip ?? undefined,
      metadata: { host: conn.host, port: conn.port },
      routingDecision,
    });

    res.json({ token, enableDrive, sessionId });
  } catch (err) {
    const errorMessage = err instanceof z.ZodError
      ? err.issues[0].message
      : err instanceof Error ? err.message : 'Unknown error';

    auditService.log({
      userId: req.user?.userId,
      action: 'SESSION_ERROR',
      targetType: 'Connection',
      targetId: connectionId,
      details: {
        protocol: 'RDP',
        error: errorMessage,
        ...(connHost ? { host: connHost, port: connPort } : {}),
      },
      ipAddress: req.ip,
      gatewayId: gatewayId ?? undefined,
    });

    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

// ---- SSH access validation (unchanged from rdp.handler.ts) ----

export async function validateSshAccess(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { connectionId } = sessionSchema.parse(req.body);
    const conn = await getConnection(req.user!.userId, connectionId, req.user!.tenantId);

    if (conn.type !== 'SSH') {
      throw new AppError('Not an SSH connection', 400);
    }

    // SSH sessions are handled via Socket.io, we just validate access here
    res.json({ connectionId, type: 'SSH' });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

// ---- RDP heartbeat ----

export async function rdpHeartbeat(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const sessionId = req.params.sessionId as string;
    const session = await prisma.activeSession.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.userId !== req.user!.userId) {
      throw new AppError('Session not found', 404);
    }
    if (session.status === 'CLOSED') {
      throw new AppError('Session already closed', 410);
    }
    await sessionService.heartbeat(sessionId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// ---- RDP session end ----

export async function rdpEnd(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const sessionId = req.params.sessionId as string;
    const session = await prisma.activeSession.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.userId !== req.user!.userId) {
      throw new AppError('Session not found', 404);
    }
    await sessionService.endSession(sessionId, 'client_disconnect');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// ---- Admin: list active sessions ----

export async function listActiveSessions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const protocol = req.query.protocol as string | undefined;
    const gatewayId = req.query.gatewayId as string | undefined;

    const sessions = await sessionService.getActiveSessions({
      tenantId: req.user!.tenantId,
      protocol: protocol === 'SSH' ? 'SSH' : protocol === 'RDP' ? 'RDP' : undefined,
      gatewayId,
    });
    res.json(sessions);
  } catch (err) {
    next(err);
  }
}

// ---- Admin: session count ----

export async function getSessionCount(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const count = await sessionService.getActiveSessionCount({
      tenantId: req.user!.tenantId,
    });
    res.json({ count });
  } catch (err) {
    next(err);
  }
}

// ---- Admin: session count by gateway ----

export async function getSessionCountByGateway(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const counts = await sessionService.getActiveSessionCountByGateway(req.user!.tenantId!);
    res.json(counts);
  } catch (err) {
    next(err);
  }
}

// ---- Admin: terminate session ----

export async function terminateSession(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const sessionId = req.params.sessionId as string;
    const session = await prisma.activeSession.findUnique({
      where: { id: sessionId },
      include: { user: { select: { tenantId: true } } },
    });
    if (!session || session.user?.tenantId !== req.user!.tenantId) {
      throw new AppError('Session not found', 404);
    }
    await sessionService.endSession(sessionId, 'admin_terminated');

    auditService.log({
      userId: req.user!.userId,
      action: 'SESSION_TERMINATE',
      targetType: 'Session',
      targetId: sessionId,
      details: {
        terminatedUserId: session.userId,
        protocol: session.protocol,
        connectionId: session.connectionId,
      },
      ipAddress: req.ip,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
