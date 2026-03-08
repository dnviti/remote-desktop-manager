import { AppError } from '../middleware/error.middleware';

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
