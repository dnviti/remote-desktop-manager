import prisma, { CheckoutStatus, Prisma } from '../lib/prisma';
import { AppError } from '../middleware/error.middleware';
import { createNotificationAsync } from './notification.service';
import { emitNotification } from '../socket/notification.handler';
import * as auditService from './audit.service';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckoutRequestInput {
  secretId?: string;
  connectionId?: string;
  durationMinutes: number;
  reason?: string;
}

export interface CheckoutRequestEntry {
  id: string;
  secretId: string | null;
  connectionId: string | null;
  requesterId: string;
  approverId: string | null;
  status: CheckoutStatus;
  durationMinutes: number;
  reason: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  requester: { email: string; username: string | null };
  approver?: { email: string; username: string | null } | null;
  secretName?: string | null;
  connectionName?: string | null;
}

export interface PaginatedCheckoutRequests {
  data: CheckoutRequestEntry[];
  total: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const checkoutSelect = {
  id: true,
  secretId: true,
  connectionId: true,
  requesterId: true,
  approverId: true,
  status: true,
  durationMinutes: true,
  reason: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
  requester: { select: { email: true, username: true } },
  approver: { select: { email: true, username: true } },
} as const;

function displayName(u: { username: string | null; email: string }): string {
  return u.username || u.email;
}

/**
 * Resolve the display name of a secret or connection by ID.
 * Returns a fallback if the record no longer exists.
 */
async function resolveTargetName(secretId?: string | null, connectionId?: string | null): Promise<string> {
  if (secretId) {
    const secret = await prisma.vaultSecret.findUnique({ where: { id: secretId }, select: { name: true } });
    return secret?.name ?? 'a secret';
  }
  if (connectionId) {
    const conn = await prisma.connection.findUnique({ where: { id: connectionId }, select: { name: true } });
    return conn?.name ?? 'a connection';
  }
  return 'a resource';
}

/**
 * Send a checkout notification to a user (persisted + real-time).
 */
function sendCheckoutNotification(
  userId: string,
  type: 'SECRET_CHECKOUT_REQUESTED' | 'SECRET_CHECKOUT_APPROVED' | 'SECRET_CHECKOUT_DENIED' | 'SECRET_CHECKOUT_EXPIRED',
  message: string,
  relatedId: string,
): void {
  createNotificationAsync({ userId, type, message, relatedId });
  emitNotification(userId, {
    id: '',
    type,
    message,
    read: false,
    relatedId,
    createdAt: new Date(),
  });
}

/**
 * Find OWNER/ADMIN users who can approve checkout requests for a given
 * secret or connection. Returns the owner of the secret/connection,
 * plus any tenant OWNER/ADMIN members.
 */
async function findApprovers(secretId?: string | null, connectionId?: string | null): Promise<string[]> {
  const approverIds = new Set<string>();

  if (secretId) {
    const secret = await prisma.vaultSecret.findUnique({
      where: { id: secretId },
      select: { userId: true, tenantId: true },
    });
    if (secret) {
      approverIds.add(secret.userId);
      if (secret.tenantId) {
        const admins = await prisma.tenantMember.findMany({
          where: { tenantId: secret.tenantId, role: { in: ['OWNER', 'ADMIN'] } },
          select: { userId: true },
        });
        for (const a of admins) approverIds.add(a.userId);
      }
    }
  }

  if (connectionId) {
    const conn = await prisma.connection.findUnique({
      where: { id: connectionId },
      select: { userId: true, teamId: true },
    });
    if (conn) {
      approverIds.add(conn.userId);
      // If the connection belongs to a team, add team admins
      if (conn.teamId) {
        const teamAdmins = await prisma.teamMember.findMany({
          where: { teamId: conn.teamId, role: 'TEAM_ADMIN' },
          select: { userId: true },
        });
        for (const a of teamAdmins) approverIds.add(a.userId);
      }
    }
  }

  return Array.from(approverIds);
}

/**
 * Batch-resolve secret and connection names for a list of checkout requests.
 * Returns a map of resourceId -> name.
 */
async function batchResolveResourceNames(
  items: Array<{ secretId: string | null; connectionId: string | null }>,
): Promise<{ secretNames: Map<string, string>; connectionNames: Map<string, string> }> {
  const secretIds = [...new Set(items.map((i) => i.secretId).filter((id): id is string => id !== null))];
  const connectionIds = [...new Set(items.map((i) => i.connectionId).filter((id): id is string => id !== null))];

  const secretNames = new Map<string, string>();
  const connectionNames = new Map<string, string>();

  if (secretIds.length > 0) {
    const secrets = await prisma.vaultSecret.findMany({
      where: { id: { in: secretIds } },
      select: { id: true, name: true },
    });
    for (const s of secrets) secretNames.set(s.id, s.name);
  }

  if (connectionIds.length > 0) {
    const connections = await prisma.connection.findMany({
      where: { id: { in: connectionIds } },
      select: { id: true, name: true },
    });
    for (const c of connections) connectionNames.set(c.id, c.name);
  }

  return { secretNames, connectionNames };
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

/**
 * Request temporary checkout of a secret or connection.
 */
export async function requestCheckout(
  requesterId: string,
  input: CheckoutRequestInput,
  ipAddress?: string | string[],
): Promise<CheckoutRequestEntry> {
  if (!input.secretId && !input.connectionId) {
    throw new AppError('Either secretId or connectionId is required', 400);
  }
  if (input.secretId && input.connectionId) {
    throw new AppError('Provide either secretId or connectionId, not both', 400);
  }
  if (input.durationMinutes < 1 || input.durationMinutes > 1440) {
    throw new AppError('Duration must be between 1 and 1440 minutes (24h)', 400);
  }

  // Verify the target resource exists
  let targetName = '';
  if (input.secretId) {
    const secret = await prisma.vaultSecret.findUnique({
      where: { id: input.secretId },
      select: { id: true, name: true, userId: true },
    });
    if (!secret) throw new AppError('Secret not found', 404);
    if (secret.userId === requesterId) {
      throw new AppError('Cannot check out your own secret', 400);
    }
    targetName = secret.name;
  }
  if (input.connectionId) {
    const conn = await prisma.connection.findUnique({
      where: { id: input.connectionId },
      select: { id: true, name: true, userId: true },
    });
    if (!conn) throw new AppError('Connection not found', 404);
    if (conn.userId === requesterId) {
      throw new AppError('Cannot check out your own connection', 400);
    }
    targetName = conn.name;
  }

  // Check for existing pending request
  const existing = await prisma.secretCheckoutRequest.findFirst({
    where: {
      requesterId,
      status: 'PENDING',
      ...(input.secretId ? { secretId: input.secretId } : {}),
      ...(input.connectionId ? { connectionId: input.connectionId } : {}),
    },
  });
  if (existing) {
    throw new AppError('A pending checkout request already exists for this resource', 409);
  }

  const request = await prisma.secretCheckoutRequest.create({
    data: {
      secretId: input.secretId ?? null,
      connectionId: input.connectionId ?? null,
      requesterId,
      durationMinutes: input.durationMinutes,
      reason: input.reason ?? null,
    },
    select: checkoutSelect,
  });

  // Audit log
  auditService.log({
    userId: requesterId,
    action: 'SECRET_CHECKOUT_REQUESTED',
    targetType: input.secretId ? 'VaultSecret' : 'Connection',
    targetId: input.secretId ?? input.connectionId ?? undefined,
    details: {
      checkoutId: request.id,
      durationMinutes: input.durationMinutes,
      reason: input.reason,
    },
    ipAddress,
  });

  // Notify approvers
  const approverIds = await findApprovers(input.secretId, input.connectionId);
  const requesterName = displayName(request.requester);
  const resourceType = input.secretId ? 'secret' : 'connection';

  for (const approverId of approverIds) {
    if (approverId === requesterId) continue;
    const msg = `${requesterName} requests temporary access to ${resourceType} "${targetName}" for ${input.durationMinutes} minutes`;
    sendCheckoutNotification(approverId, 'SECRET_CHECKOUT_REQUESTED', msg, request.id);
  }

  return {
    ...request,
    secretName: input.secretId ? targetName : null,
    connectionName: input.connectionId ? targetName : null,
  };
}

/**
 * Approve a pending checkout request. Creates a time-limited share.
 * Uses an atomic status transition to prevent TOCTOU race conditions.
 */
export async function approveCheckout(
  approverId: string,
  requestId: string,
  ipAddress?: string | string[],
): Promise<CheckoutRequestEntry> {
  const request = await prisma.secretCheckoutRequest.findUnique({
    where: { id: requestId },
    select: checkoutSelect,
  });
  if (!request) throw new AppError('Checkout request not found', 404);
  if (request.status !== 'PENDING') {
    throw new AppError(`Request is already ${request.status.toLowerCase()}`, 400);
  }

  // Verify the approver has authority
  const approverIds = await findApprovers(request.secretId, request.connectionId);
  if (!approverIds.includes(approverId)) {
    throw new AppError('You are not authorized to approve this request', 403);
  }

  const expiresAt = new Date(Date.now() + request.durationMinutes * 60 * 1000);

  // Atomic status transition: only update if still PENDING (prevents TOCTOU race)
  let updated: Awaited<ReturnType<typeof prisma.secretCheckoutRequest.updateMany>>;
  try {
    updated = await prisma.secretCheckoutRequest.updateMany({
      where: { id: requestId, status: 'PENDING' },
      data: {
        status: 'APPROVED',
        approverId,
        expiresAt,
      },
    });
  } catch (err) {
    logger.error(`[checkout] Failed to approve checkout ${requestId}:`, (err as Error).message);
    throw new AppError('Failed to approve checkout request', 500);
  }

  if (updated.count === 0) {
    throw new AppError('Request was already processed by another user', 409);
  }

  // Re-fetch the updated record for the response
  const result = await prisma.secretCheckoutRequest.findUnique({
    where: { id: requestId },
    select: checkoutSelect,
  });
  if (!result) throw new AppError('Checkout request not found after update', 500);

  // Audit log
  auditService.log({
    userId: approverId,
    action: 'SECRET_CHECKOUT_APPROVED',
    targetType: request.secretId ? 'VaultSecret' : 'Connection',
    targetId: request.secretId ?? request.connectionId ?? undefined,
    details: {
      checkoutId: requestId,
      requesterId: request.requesterId,
      durationMinutes: request.durationMinutes,
      expiresAt: expiresAt.toISOString(),
    },
    ipAddress,
  });

  // Notify requester
  const approverUser = await prisma.user.findUnique({
    where: { id: approverId },
    select: { username: true, email: true },
  });
  const approverName = approverUser ? displayName(approverUser) : 'An administrator';
  const targetName = await resolveTargetName(request.secretId, request.connectionId);
  const resourceType = request.secretId ? 'secret' : 'connection';
  const msg = `${approverName} approved your checkout of ${resourceType} "${targetName}" for ${request.durationMinutes} minutes`;
  sendCheckoutNotification(request.requesterId, 'SECRET_CHECKOUT_APPROVED', msg, requestId);

  return result;
}

/**
 * Reject a pending checkout request.
 * Uses an atomic status transition to prevent TOCTOU race conditions.
 */
export async function rejectCheckout(
  approverId: string,
  requestId: string,
  ipAddress?: string | string[],
): Promise<CheckoutRequestEntry> {
  const request = await prisma.secretCheckoutRequest.findUnique({
    where: { id: requestId },
    select: checkoutSelect,
  });
  if (!request) throw new AppError('Checkout request not found', 404);
  if (request.status !== 'PENDING') {
    throw new AppError(`Request is already ${request.status.toLowerCase()}`, 400);
  }

  // Verify the approver has authority
  const approverIds = await findApprovers(request.secretId, request.connectionId);
  if (!approverIds.includes(approverId)) {
    throw new AppError('You are not authorized to reject this request', 403);
  }

  // Atomic status transition: only update if still PENDING (prevents TOCTOU race)
  const atomicUpdate = await prisma.secretCheckoutRequest.updateMany({
    where: { id: requestId, status: 'PENDING' },
    data: {
      status: 'REJECTED',
      approverId,
    },
  });

  if (atomicUpdate.count === 0) {
    throw new AppError('Request was already processed by another user', 409);
  }

  // Re-fetch the updated record for the response
  const updated = await prisma.secretCheckoutRequest.findUnique({
    where: { id: requestId },
    select: checkoutSelect,
  });
  if (!updated) throw new AppError('Checkout request not found after update', 500);

  // Audit log
  auditService.log({
    userId: approverId,
    action: 'SECRET_CHECKOUT_DENIED',
    targetType: request.secretId ? 'VaultSecret' : 'Connection',
    targetId: request.secretId ?? request.connectionId ?? undefined,
    details: {
      checkoutId: requestId,
      requesterId: request.requesterId,
    },
    ipAddress,
  });

  // Notify requester
  const approverUser = await prisma.user.findUnique({
    where: { id: approverId },
    select: { username: true, email: true },
  });
  const approverName = approverUser ? displayName(approverUser) : 'An administrator';
  const targetName = await resolveTargetName(request.secretId, request.connectionId);
  const resourceType = request.secretId ? 'secret' : 'connection';
  const msg = `${approverName} denied your checkout of ${resourceType} "${targetName}"`;
  sendCheckoutNotification(request.requesterId, 'SECRET_CHECKOUT_DENIED', msg, requestId);

  return updated;
}

/**
 * Manually check in (return) a checked-out credential before expiry.
 */
export async function checkinCheckout(
  userId: string,
  requestId: string,
  ipAddress?: string | string[],
): Promise<CheckoutRequestEntry> {
  const request = await prisma.secretCheckoutRequest.findUnique({
    where: { id: requestId },
    select: checkoutSelect,
  });
  if (!request) throw new AppError('Checkout request not found', 404);
  if (request.status !== 'APPROVED') {
    throw new AppError('Only approved checkouts can be checked in', 400);
  }
  // Only the requester or an approver can check in
  if (request.requesterId !== userId) {
    const approverIds = await findApprovers(request.secretId, request.connectionId);
    if (!approverIds.includes(userId)) {
      throw new AppError('You are not authorized to check in this request', 403);
    }
  }

  const updated = await prisma.secretCheckoutRequest.update({
    where: { id: requestId },
    data: { status: 'CHECKED_IN' },
    select: checkoutSelect,
  });

  auditService.log({
    userId,
    action: 'SECRET_CHECKOUT_CHECKED_IN',
    targetType: request.secretId ? 'VaultSecret' : 'Connection',
    targetId: request.secretId ?? request.connectionId ?? undefined,
    details: { checkoutId: requestId },
    ipAddress,
  });

  return updated;
}

/**
 * List checkout requests for the current user (as requester or approver).
 */
export async function listCheckoutRequests(
  userId: string,
  role: 'requester' | 'approver' | 'all',
  status?: CheckoutStatus,
  limit = 50,
  offset = 0,
): Promise<PaginatedCheckoutRequests> {
  const safeLimit = Math.min(limit, 100);
  const where: Prisma.SecretCheckoutRequestWhereInput = {};

  if (role === 'requester') {
    where.requesterId = userId;
  } else if (role === 'approver') {
    // Find resources this user can approve (owns or administers)
    // 1. Secrets the user owns or is tenant admin for
    const ownedSecrets = await prisma.vaultSecret.findMany({
      where: { userId },
      select: { id: true },
    });
    const adminTenants = await prisma.tenantMember.findMany({
      where: { userId, role: { in: ['OWNER', 'ADMIN'] } },
      select: { tenantId: true },
    });
    const tenantSecrets = adminTenants.length > 0
      ? await prisma.vaultSecret.findMany({
          where: { tenantId: { in: adminTenants.map((t: { tenantId: string }) => t.tenantId) } },
          select: { id: true },
        })
      : [];
    const approvableSecretIds = [...new Set([
      ...ownedSecrets.map((s: { id: string }) => s.id),
      ...tenantSecrets.map((s: { id: string }) => s.id),
    ])];

    // 2. Connections the user owns or is team admin for
    const ownedConnections = await prisma.connection.findMany({
      where: { userId },
      select: { id: true },
    });
    const adminTeams = await prisma.teamMember.findMany({
      where: { userId, role: 'TEAM_ADMIN' },
      select: { teamId: true },
    });
    const teamConnections = adminTeams.length > 0
      ? await prisma.connection.findMany({
          where: { teamId: { in: adminTeams.map((t: { teamId: string }) => t.teamId) } },
          select: { id: true },
        })
      : [];
    const approvableConnectionIds = [...new Set([
      ...ownedConnections.map((c: { id: string }) => c.id),
      ...teamConnections.map((c: { id: string }) => c.id),
    ])];

    // Build filter: only requests for resources this user can approve, excluding own requests
    const orConditions: Prisma.SecretCheckoutRequestWhereInput[] = [];
    if (approvableSecretIds.length > 0) {
      orConditions.push({ secretId: { in: approvableSecretIds }, requesterId: { not: userId } });
    }
    if (approvableConnectionIds.length > 0) {
      orConditions.push({ connectionId: { in: approvableConnectionIds }, requesterId: { not: userId } });
    }

    if (orConditions.length === 0) {
      // User has no resources to approve -- return empty
      return { data: [], total: 0 };
    }
    where.OR = orConditions;
  } else {
    where.OR = [
      { requesterId: userId },
      { approverId: userId },
    ];
  }

  if (status) {
    where.status = status;
  }

  const [data, total] = await Promise.all([
    prisma.secretCheckoutRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: safeLimit,
      select: checkoutSelect,
    }),
    prisma.secretCheckoutRequest.count({ where }),
  ]);

  // Batch-resolve resource names (fixes N+1 query)
  const { secretNames, connectionNames } = await batchResolveResourceNames(data);

  const enriched: CheckoutRequestEntry[] = data.map((item: typeof data[number]) => ({
    ...item,
    secretName: item.secretId ? (secretNames.get(item.secretId) ?? null) : null,
    connectionName: item.connectionId ? (connectionNames.get(item.connectionId) ?? null) : null,
  }));

  return { data: enriched, total };
}

/**
 * Get a single checkout request by ID.
 * Verifies the requesting user has access (requester, approver, or resource owner/admin).
 */
export async function getCheckoutRequest(
  requestId: string,
  userId: string,
): Promise<CheckoutRequestEntry | null> {
  const request = await prisma.secretCheckoutRequest.findUnique({
    where: { id: requestId },
    select: checkoutSelect,
  });
  if (!request) return null;

  // Authorization: only requester, approver, or resource owner/admin can view
  if (request.requesterId !== userId && request.approverId !== userId) {
    const authorizedIds = await findApprovers(request.secretId, request.connectionId);
    if (!authorizedIds.includes(userId)) {
      throw new AppError('You are not authorized to view this checkout request', 403);
    }
  }

  const targetName = await resolveTargetName(request.secretId, request.connectionId);

  return {
    ...request,
    secretName: request.secretId ? targetName : null,
    connectionName: request.connectionId ? targetName : null,
  };
}

/**
 * Process expired checkout requests (called by scheduler).
 * Marks APPROVED requests whose expiresAt has passed as EXPIRED.
 * Uses an atomic updateMany to prevent race conditions in multi-instance deployments.
 */
export async function processExpiredCheckouts(): Promise<number> {
  const now = new Date();

  // Atomically mark all expired checkouts in a single query
  const updateResult = await prisma.secretCheckoutRequest.updateMany({
    where: {
      status: 'APPROVED',
      expiresAt: { not: null, lte: now },
    },
    data: { status: 'EXPIRED' },
  });

  if (updateResult.count === 0) return 0;

  // Fetch the just-expired records for audit logging and notifications
  // Use a small time window to catch records we just updated
  const expired = await prisma.secretCheckoutRequest.findMany({
    where: {
      status: 'EXPIRED',
      // Records updated in the last 10 minutes (generous window for the scheduler interval)
      updatedAt: { gte: new Date(now.getTime() - 10 * 60 * 1000), lte: now },
    },
    select: {
      id: true,
      secretId: true,
      connectionId: true,
      requesterId: true,
      requester: { select: { email: true, username: true } },
    },
  });

  // Batch-resolve resource names for notifications
  const { secretNames, connectionNames } = await batchResolveResourceNames(expired);

  for (const item of expired) {
    auditService.log({
      action: 'SECRET_CHECKOUT_EXPIRED',
      targetType: item.secretId ? 'VaultSecret' : 'Connection',
      targetId: item.secretId ?? item.connectionId ?? undefined,
      details: { checkoutId: item.id, requesterId: item.requesterId },
    });

    const resourceType = item.secretId ? 'secret' : 'connection';
    const targetName = item.secretId
      ? (secretNames.get(item.secretId) ?? 'a secret')
      : (item.connectionId ? connectionNames.get(item.connectionId) ?? 'a connection' : 'a connection');
    const msg = `Your temporary access to ${resourceType} "${targetName}" has expired (auto check-in)`;
    sendCheckoutNotification(item.requesterId, 'SECRET_CHECKOUT_EXPIRED', msg, item.id);
  }

  logger.info(`[checkout] Expired ${updateResult.count} checkout(s)`);
  return updateResult.count;
}
