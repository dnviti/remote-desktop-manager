import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest, assertAuthenticated, assertTenantAuthenticated } from '../types';
import * as teamService from '../services/team.service';
import * as auditService from '../services/audit.service';
import { AppError } from '../middleware/error.middleware';
import { getClientIp } from '../utils/ip';

const createTeamSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
});

const updateTeamSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
});

const addMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['TEAM_ADMIN', 'TEAM_EDITOR', 'TEAM_VIEWER']),
});

const updateMemberRoleSchema = z.object({
  role: z.enum(['TEAM_ADMIN', 'TEAM_EDITOR', 'TEAM_VIEWER']),
});

export async function createTeam(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertTenantAuthenticated(req);
    const { name, description } = createTeamSchema.parse(req.body);
    const result = await teamService.createTeam(
      req.user.tenantId,
      req.user.userId,
      name,
      description
    );
    auditService.log({
      userId: req.user.userId, action: 'TEAM_CREATE',
      targetType: 'Team', targetId: result.id,
      details: { name },
      ipAddress: getClientIp(req),
    });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function listTeams(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertTenantAuthenticated(req);
    const result = await teamService.listUserTeams(req.user.userId, req.user.tenantId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getTeam(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const result = await teamService.getTeam(req.params.id as string, req.user.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function updateTeam(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const data = updateTeamSchema.parse(req.body);
    const teamId = req.params.id as string;
    const result = await teamService.updateTeam(teamId, data);
    auditService.log({
      userId: req.user.userId, action: 'TEAM_UPDATE',
      targetType: 'Team', targetId: teamId,
      details: { fields: Object.keys(data) },
      ipAddress: getClientIp(req),
    });
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function deleteTeam(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const teamId = req.params.id as string;
    const result = await teamService.deleteTeam(teamId);
    auditService.log({
      userId: req.user.userId, action: 'TEAM_DELETE',
      targetType: 'Team', targetId: teamId,
      ipAddress: getClientIp(req),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function listMembers(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await teamService.listMembers(req.params.id as string);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function addMember(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { userId, role } = addMemberSchema.parse(req.body);
    const teamId = req.params.id as string;
    const result = await teamService.addMember(teamId, userId, role, req.user.userId);
    auditService.log({
      userId: req.user.userId, action: 'TEAM_ADD_MEMBER',
      targetType: 'TeamMember', targetId: userId,
      details: { teamId, role },
      ipAddress: getClientIp(req),
    });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function updateMemberRole(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { role } = updateMemberRoleSchema.parse(req.body);
    const teamId = req.params.id as string;
    const targetUserId = req.params.userId as string;
    const result = await teamService.updateMemberRole(teamId, targetUserId, role, req.user.userId);
    auditService.log({
      userId: req.user.userId, action: 'TEAM_UPDATE_MEMBER_ROLE',
      targetType: 'TeamMember', targetId: targetUserId,
      details: { teamId, newRole: role },
      ipAddress: getClientIp(req),
    });
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function removeMember(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const teamId = req.params.id as string;
    const targetUserId = req.params.userId as string;
    const result = await teamService.removeMember(teamId, targetUserId, req.user.userId);
    auditService.log({
      userId: req.user.userId, action: 'TEAM_REMOVE_MEMBER',
      targetType: 'TeamMember', targetId: targetUserId,
      details: { teamId },
      ipAddress: getClientIp(req),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}
