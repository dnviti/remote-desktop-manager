import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import prisma from '../lib/prisma';

type TeamRoleType = 'TEAM_ADMIN' | 'TEAM_EDITOR' | 'TEAM_VIEWER';

const TEAM_ROLE_HIERARCHY: Record<string, number> = {
  TEAM_VIEWER: 1,
  TEAM_EDITOR: 2,
  TEAM_ADMIN: 3,
};

/**
 * Loads team membership for the current user and attaches it to the request.
 * Also validates the team belongs to the user's tenant.
 * Expects :id param to be the teamId.
 */
export async function requireTeamMember(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const teamId = req.params.id as string;
  const userId = req.user?.userId;

  if (!teamId || !userId) {
    res.status(400).json({ error: 'Missing team ID or user' });
    return;
  }

  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
    include: { team: true },
  });

  if (!membership) {
    res.status(404).json({ error: 'Team not found' });
    return;
  }

  // Ensure team belongs to user's tenant
  if (membership.team.tenantId !== req.user?.tenantId) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  req.teamMembership = {
    teamId,
    role: membership.role,
    tenantId: membership.team.tenantId,
  };

  next();
}

/**
 * Requires the user to have at least the given team role.
 * Must be used AFTER requireTeamMember.
 * Set allowTenantAdmin to let tenant ADMIN/OWNER bypass the check.
 */
export function requireTeamRole(minRole: TeamRoleType, { allowTenantAdmin = false } = {}) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    // Allow tenant ADMIN+ to bypass team role checks
    if (allowTenantAdmin) {
      const tenantRole = req.user?.tenantRole;
      if (tenantRole === 'ADMIN' || tenantRole === 'OWNER') {
        next();
        return;
      }
    }

    const membership = req.teamMembership;
    if (!membership || TEAM_ROLE_HIERARCHY[membership.role] < TEAM_ROLE_HIERARCHY[minRole]) {
      res.status(403).json({ error: 'Insufficient team role' });
      return;
    }
    next();
  };
}
