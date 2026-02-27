import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';

const ROLE_HIERARCHY: Record<string, number> = {
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
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
 * Hierarchy: OWNER > ADMIN > MEMBER
 * Must be used AFTER `requireTenant`.
 */
export function requireTenantRole(minRole: 'MEMBER' | 'ADMIN' | 'OWNER') {
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
