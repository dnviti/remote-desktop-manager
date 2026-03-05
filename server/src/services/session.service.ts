import crypto from 'crypto';
import prisma, { Prisma, SessionProtocol, SessionStatus } from '../lib/prisma';
import * as auditService from './audit.service';
import { formatDuration } from '../utils/format';
import { logger } from '../utils/logger';

const log = logger.child('session');

// ---------- Types ----------

export interface StartSessionParams {
  userId: string;
  connectionId: string;
  gatewayId?: string | null;
  instanceId?: string | null;
  protocol: SessionProtocol;
  socketId?: string;
  guacToken?: string;
  ipAddress?: string | string[];
  metadata?: Record<string, unknown>;
}

export interface ActiveSessionFilter {
  userId?: string;
  protocol?: SessionProtocol;
  status?: SessionStatus;
  gatewayId?: string;
  tenantId?: string;
}

export interface ActiveSessionDTO {
  id: string;
  userId: string;
  username: string | null;
  email: string;
  connectionId: string;
  connectionName: string;
  connectionHost: string;
  connectionPort: number;
  gatewayId: string | null;
  gatewayName: string | null;
  instanceId: string | null;
  instanceName: string | null;
  protocol: SessionProtocol;
  status: SessionStatus;
  startedAt: Date;
  lastActivityAt: Date;
  endedAt: Date | null;
  durationFormatted: string;
}

// ---------- Helpers ----------

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ---------- Core Operations ----------

export async function startSession(params: StartSessionParams): Promise<string> {
  try {
    const session = await prisma.activeSession.create({
      data: {
        userId: params.userId,
        connectionId: params.connectionId,
        gatewayId: params.gatewayId ?? null,
        instanceId: params.instanceId ?? null,
        protocol: params.protocol,
        status: 'ACTIVE',
        socketId: params.socketId ?? null,
        guacTokenHash: params.guacToken ? hashToken(params.guacToken) : null,
        metadata: (params.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      },
      include: { gateway: params.gatewayId ? { select: { name: true } } : false },
    });

    auditService.log({
      userId: params.userId,
      action: 'SESSION_START',
      targetType: 'Connection',
      targetId: params.connectionId,
      details: {
        sessionId: session.id,
        protocol: params.protocol,
        ...(params.metadata ?? {}),
        ...(params.gatewayId ? { gatewayName: session.gateway?.name ?? null, instanceId: params.instanceId ?? null } : {}),
      },
      ipAddress: params.ipAddress,
      gatewayId: params.gatewayId,
    });

    log.debug(`Started session ${session.id} (${params.protocol}) for user ${params.userId}, connection ${params.connectionId}`);
    return session.id;
  } catch (err) {
    log.error('Failed to start session:', err);
    throw err;
  }
}

export async function endSession(
  sessionId: string,
  reason?: string,
): Promise<void> {
  try {
    const session = await prisma.activeSession.findUnique({
      where: { id: sessionId },
      include: { gateway: { select: { name: true } } },
    });
    if (!session || session.status === 'CLOSED') return;

    const now = new Date();
    const durationMs = now.getTime() - session.startedAt.getTime();

    await prisma.activeSession.update({
      where: { id: sessionId },
      data: { status: 'CLOSED', endedAt: now },
    });

    log.debug(`Ended session ${sessionId} (duration ${durationMs}ms)`);

    auditService.log({
      userId: session.userId,
      action: 'SESSION_END',
      targetType: 'Connection',
      targetId: session.connectionId,
      details: {
        sessionId,
        protocol: session.protocol,
        durationMs,
        durationFormatted: formatDuration(durationMs),
        ...(reason ? { reason } : {}),
        ...(session.gatewayId ? { gatewayName: session.gateway?.name ?? null, instanceId: session.instanceId } : {}),
      },
      gatewayId: session.gatewayId,
    });
  } catch (err) {
    log.error('Failed to end session:', err);
  }
}

export async function endSessionBySocketId(socketId: string): Promise<void> {
  try {
    const session = await prisma.activeSession.findFirst({
      where: { socketId, status: { not: 'CLOSED' } },
    });
    if (session) {
      await endSession(session.id, 'socket_disconnect');
    }
  } catch (err) {
    log.error('Failed to end session by socketId:', err);
  }
}

export async function endSessionByGuacTokenHash(tokenHash: string): Promise<void> {
  try {
    const session = await prisma.activeSession.findFirst({
      where: { guacTokenHash: tokenHash, status: { not: 'CLOSED' } },
    });
    if (session) {
      await endSession(session.id, 'guac_close');
    }
  } catch (err) {
    log.error('Failed to end session by guacTokenHash:', err);
  }
}

export async function heartbeat(sessionId: string): Promise<void> {
  await prisma.activeSession.updateMany({
    where: { id: sessionId, status: { not: 'CLOSED' } },
    data: { lastActivityAt: new Date(), status: 'ACTIVE' },
  });
}

export async function heartbeatBySocketId(socketId: string): Promise<void> {
  await prisma.activeSession.updateMany({
    where: { socketId, status: { not: 'CLOSED' } },
    data: { lastActivityAt: new Date(), status: 'ACTIVE' },
  });
}

// ---------- Query Operations ----------

export async function getActiveSessions(
  filters?: ActiveSessionFilter,
): Promise<ActiveSessionDTO[]> {
  const where: Prisma.ActiveSessionWhereInput = {};
  if (filters?.status) where.status = filters.status;
  else where.status = { not: 'CLOSED' };
  if (filters?.userId) where.userId = filters.userId;
  if (filters?.protocol) where.protocol = filters.protocol;
  if (filters?.gatewayId) where.gatewayId = filters.gatewayId;
  if (filters?.tenantId) where.user = { tenantId: filters.tenantId };

  const sessions = await prisma.activeSession.findMany({
    where,
    include: {
      user: { select: { email: true, username: true } },
      connection: { select: { name: true, host: true, port: true } },
      gateway: { select: { name: true } },
      instance: { select: { containerName: true } },
    },
    orderBy: { startedAt: 'desc' },
  });

  const now = Date.now();
  return sessions.map((s) => ({
    id: s.id,
    userId: s.userId,
    username: s.user.username,
    email: s.user.email,
    connectionId: s.connectionId,
    connectionName: s.connection.name,
    connectionHost: s.connection.host,
    connectionPort: s.connection.port,
    gatewayId: s.gatewayId,
    gatewayName: s.gateway?.name ?? null,
    instanceId: s.instanceId,
    instanceName: s.instance?.containerName ?? null,
    protocol: s.protocol,
    status: s.status,
    startedAt: s.startedAt,
    lastActivityAt: s.lastActivityAt,
    endedAt: s.endedAt,
    durationFormatted: formatDuration(
      (s.endedAt?.getTime() ?? now) - s.startedAt.getTime(),
    ),
  }));
}

export async function getActiveSessionCount(
  filters?: ActiveSessionFilter,
): Promise<number> {
  const where: Prisma.ActiveSessionWhereInput = { status: { not: 'CLOSED' } };
  if (filters?.userId) where.userId = filters.userId;
  if (filters?.protocol) where.protocol = filters.protocol;
  if (filters?.gatewayId) where.gatewayId = filters.gatewayId;
  if (filters?.tenantId) where.user = { tenantId: filters.tenantId };

  return prisma.activeSession.count({ where });
}

export async function getActiveSessionCountByGateway(
  tenantId: string,
): Promise<Array<{ gatewayId: string; gatewayName: string; count: number }>> {
  const sessions = await prisma.activeSession.findMany({
    where: {
      status: { not: 'CLOSED' },
      gatewayId: { not: null },
      gateway: { tenantId },
    },
    select: {
      gatewayId: true,
      gateway: { select: { name: true } },
    },
  });

  const grouped = new Map<string, { name: string; count: number }>();
  for (const s of sessions) {
    if (!s.gatewayId) continue;
    const existing = grouped.get(s.gatewayId);
    if (existing) existing.count++;
    else grouped.set(s.gatewayId, { name: s.gateway!.name, count: 1 });
  }

  return Array.from(grouped.entries()).map(([gatewayId, { name, count }]) => ({
    gatewayId,
    gatewayName: name,
    count,
  }));
}

// ---------- Maintenance Operations ----------

export async function markIdleSessions(thresholdMinutes: number): Promise<number> {
  const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000);
  const result = await prisma.activeSession.updateMany({
    where: {
      status: 'ACTIVE',
      lastActivityAt: { lt: cutoff },
    },
    data: { status: 'IDLE' },
  });
  return result.count;
}

export async function cleanupClosedSessions(retentionDays: number): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const result = await prisma.activeSession.deleteMany({
    where: {
      status: 'CLOSED',
      endedAt: { lt: cutoff },
    },
  });
  return result.count;
}

export async function recoverOrphanedSessions(): Promise<number> {
  const orphaned = await prisma.activeSession.findMany({
    where: { status: { not: 'CLOSED' } },
    include: { gateway: { select: { name: true } } },
  });

  if (orphaned.length === 0) return 0;

  const now = new Date();
  await prisma.activeSession.updateMany({
    where: { status: { not: 'CLOSED' } },
    data: { status: 'CLOSED', endedAt: now },
  });

  for (const session of orphaned) {
    auditService.log({
      userId: session.userId,
      action: 'SESSION_END',
      targetType: 'Connection',
      targetId: session.connectionId,
      details: {
        sessionId: session.id,
        protocol: session.protocol,
        reason: 'server_restart',
        durationMs: now.getTime() - session.startedAt.getTime(),
        durationFormatted: formatDuration(now.getTime() - session.startedAt.getTime()),
        ...(session.gatewayId ? { gatewayName: session.gateway?.name ?? null, instanceId: session.instanceId } : {}),
      },
      gatewayId: session.gatewayId,
    });
  }

  return orphaned.length;
}
