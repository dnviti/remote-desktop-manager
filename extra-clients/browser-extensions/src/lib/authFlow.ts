import type { LoginResult, TenantMembership } from '../types';

export function getAcceptedTenantMemberships(
  memberships?: TenantMembership[],
): TenantMembership[] {
  return (memberships ?? []).filter(
    (membership) => membership.pending !== true && membership.status !== 'PENDING',
  );
}

export function getPreferredTenantMembership(
  memberships: TenantMembership[],
): TenantMembership | undefined {
  return memberships.find((membership) => membership.isActive) ?? memberships[0];
}

export function requiresTenantSelection(result: LoginResult): boolean {
  return getAcceptedTenantMemberships(result.tenantMemberships).length >= 2;
}
