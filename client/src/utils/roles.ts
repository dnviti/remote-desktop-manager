export type TenantRole = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'MEMBER' | 'CONSULTANT' | 'AUDITOR' | 'GUEST';

const ROLE_HIERARCHY: Record<TenantRole, number> = {
  OWNER:      4,
  ADMIN:      3,
  OPERATOR:   2,
  MEMBER:     1,
  CONSULTANT: 0.5,
  AUDITOR:    0.3,
  GUEST:      0.1,
};

/** All roles, sorted from highest to lowest privilege */
export const ALL_ROLES: TenantRole[] = ['OWNER', 'ADMIN', 'OPERATOR', 'MEMBER', 'CONSULTANT', 'AUDITOR', 'GUEST'];

/** Roles that can be assigned via invite or user creation (excludes OWNER) */
export const ASSIGNABLE_ROLES: TenantRole[] = ['ADMIN', 'OPERATOR', 'MEMBER', 'CONSULTANT', 'AUDITOR', 'GUEST'];

/** Human-readable labels */
export const ROLE_LABELS: Record<TenantRole, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  OPERATOR: 'Operator',
  MEMBER: 'Member',
  CONSULTANT: 'Consultant',
  AUDITOR: 'Auditor',
  GUEST: 'Guest',
};

/** Check if user role meets a minimum hierarchy level */
export function hasMinRole(userRole: string | undefined, minRole: TenantRole): boolean {
  if (!userRole) return false;
  return (ROLE_HIERARCHY[userRole as TenantRole] ?? 0) >= ROLE_HIERARCHY[minRole];
}

/** Check if user role is one of the specified roles (non-hierarchical) */
export function hasAnyRole(userRole: string | undefined, ...roles: TenantRole[]): boolean {
  if (!userRole) return false;
  return roles.includes(userRole as TenantRole);
}

/** Shorthand: is the user ADMIN or OWNER */
export function isAdminOrAbove(userRole: string | undefined): boolean {
  return hasMinRole(userRole, 'ADMIN');
}

/** Shorthand: is the user OPERATOR, ADMIN, or OWNER */
export function isOperatorOrAbove(userRole: string | undefined): boolean {
  return hasMinRole(userRole, 'OPERATOR');
}
