import { Response, NextFunction } from 'express';
import { AuthRequest, TenantRoleType } from '../types';

const ROLE_HIERARCHY: Record<string, number> = {
  GUEST:      0.1,
  AUDITOR:    0.3,
  CONSULTANT: 0.5,
  MEMBER:     1,
  OPERATOR:   2,
  ADMIN:      3,
  OWNER:      4,
};

/**
 * Requires the authenticated user to belong to a tenant.
 * Must be used AFTER the `authenticate` middleware.
 */
export function requireTenant(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user?.tenantId) {
    res.status(403).json({ error: 'You must belong to an organization to perform this action' });
    return;
  }
  next();
}

/**
 * Requires the authenticated user to have at least the given tenant role.
 * Hierarchy: OWNER > ADMIN > OPERATOR > MEMBER > CONSULTANT > AUDITOR > GUEST
 * Must be used AFTER `requireTenant`.
 */
export function requireTenantRole(minRole: TenantRoleType) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const userRole = req.user?.tenantRole;
    if (!userRole || ROLE_HIERARCHY[userRole] < ROLE_HIERARCHY[minRole]) {
      res.status(403).json({ error: 'Insufficient tenant role' });
      return;
    }
    next();
  };
}

/**
 * Requires the authenticated user to have one of the specified roles.
 * Unlike requireTenantRole, this does NOT use hierarchy — it checks set membership.
 * Must be used AFTER `requireTenant`.
 */
export function requireTenantRoleAny(...allowedRoles: TenantRoleType[]) {
  const allowed = new Set<string>(allowedRoles);
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const userRole = req.user?.tenantRole;
    if (!userRole || !allowed.has(userRole)) {
      res.status(403).json({ error: 'Insufficient tenant role' });
      return;
    }
    next();
  };
}

/**
 * Checks whether the given role is one of the allowed roles (non-hierarchical).
 * Useful in controllers for inline permission checks.
 */
export function hasAnyRole(role: string | undefined, ...allowedRoles: string[]): boolean {
  if (!role) return false;
  return allowedRoles.includes(role);
}

/**
 * Validates that the :id URL parameter matches the user's tenantId.
 * Prevents users from accessing another tenant's endpoints.
 * Must be used AFTER `requireTenant`.
 */
export function requireOwnTenant(req: AuthRequest, res: Response, next: NextFunction): void {
  const paramTenantId = req.params.id;
  if (paramTenantId && paramTenantId !== req.user?.tenantId) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }
  next();
}
