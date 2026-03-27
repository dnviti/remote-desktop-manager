import { AppError } from '../middleware/error.middleware';
import prisma from '../lib/prisma';
import { config } from '../config';

/**
 * Asserts a resource's tenant matches the user's tenant.
 *
 * Rules:
 * - User has no tenant (null/undefined): always passes (backward compat)
 * - Resource has no tenant (personal, no team): always passes
 * - Both have tenant, same value: passes
 * - Both have tenant, different value: throws 403
 */
export function assertSameTenant(
  userTenantId: string | null | undefined,
  resourceTenantId: string | null | undefined
): void {
  if (!userTenantId) return;
  if (!resourceTenantId) return;
  if (userTenantId !== resourceTenantId) {
    throw new AppError('Access denied', 403);
  }
}

/**
 * Returns a Prisma where fragment to scope TeamMember queries
 * to teams belonging to the user's tenant.
 */
export function tenantScopedTeamFilter(
  tenantId: string | null | undefined
): Record<string, unknown> {
  if (!tenantId) return {};
  return { team: { tenantId } };
}

/**
 * Asserts both users share at least one tenant (bidirectional check).
 * Passes if neither user belongs to any tenant (backward compat).
 * Skipped entirely when ALLOW_EXTERNAL_SHARING is true.
 */
export async function assertShareableTenantBoundary(
  actingUserId: string,
  targetUserId: string
): Promise<void> {
  if (config.allowExternalSharing) return;

  const [actingMemberships, targetMemberships] = await Promise.all([
    prisma.tenantMember.findMany({
      where: {
        userId: actingUserId,
        status: 'ACCEPTED',
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      select: { tenantId: true },
    }),
    prisma.tenantMember.findMany({
      where: {
        userId: targetUserId,
        status: 'ACCEPTED',
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      select: { tenantId: true },
    }),
  ]);
  const actingTenantIds = new Set(actingMemberships.map((m) => m.tenantId));
  const targetTenantIds = new Set(targetMemberships.map((m) => m.tenantId));
  if (actingTenantIds.size > 0 || targetTenantIds.size > 0) {
    const hasCommon = [...actingTenantIds].some((id) => targetTenantIds.has(id));
    if (!hasCommon) {
      throw new AppError('Cannot share connections with users outside your tenant', 403);
    }
  }
}
