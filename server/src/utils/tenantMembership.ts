import prisma from '../lib/prisma';
import type { TenantRoleType } from '../types';

export interface TenantMembershipContext {
  userId: string;
  tenantId: string;
  role: TenantRoleType;
  status: 'PENDING' | 'ACCEPTED';
  isActive: boolean;
  expiresAt: Date | null;
  userEnabled: boolean;
}

export async function getTenantMembershipContext(
  userId: string,
  tenantId: string,
): Promise<TenantMembershipContext | null> {
  const membership = await prisma.tenantMember.findUnique({
    where: { tenantId_userId: { tenantId, userId } },
    select: {
      userId: true,
      tenantId: true,
      role: true,
      status: true,
      isActive: true,
      expiresAt: true,
      user: { select: { enabled: true } },
    },
  });

  if (!membership) return null;

  return {
    userId: membership.userId,
    tenantId: membership.tenantId,
    role: membership.role as TenantRoleType,
    status: membership.status,
    isActive: membership.isActive,
    expiresAt: membership.expiresAt,
    userEnabled: membership.user.enabled,
  };
}

export function isTenantMembershipUsable(
  membership: TenantMembershipContext | null | undefined,
  now: Date = new Date(),
): membership is TenantMembershipContext {
  if (!membership) return false;
  if (!membership.userEnabled) return false;
  if (!membership.isActive) return false;
  if (membership.status !== 'ACCEPTED') return false;
  if (membership.expiresAt && membership.expiresAt <= now) return false;
  return true;
}
