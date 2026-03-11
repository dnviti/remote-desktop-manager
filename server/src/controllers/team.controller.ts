import { Response, NextFunction } from 'express';
import { AuthRequest, assertAuthenticated, assertTenantAuthenticated } from '../types';
import * as teamService from '../services/team.service';
import * as auditService from '../services/audit.service';
import { getClientIp } from '../utils/ip';
import type { CreateTeamInput, UpdateTeamInput, AddMemberInput, UpdateMemberRoleInput } from '../schemas/team.schemas';

export async function createTeam(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertTenantAuthenticated(req);
    const { name, description } = req.body as CreateTeamInput;
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
    const data = req.body as UpdateTeamInput;
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
    const { userId, role } = req.body as AddMemberInput;
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
    next(err);
  }
}

export async function updateMemberRole(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { role } = req.body as UpdateMemberRoleInput;
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
