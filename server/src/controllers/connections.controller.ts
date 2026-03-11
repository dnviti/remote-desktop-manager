import { Response, NextFunction } from 'express';
import { AuthRequest, assertAuthenticated } from '../types';
import * as connectionService from '../services/connection.service';
import * as auditService from '../services/audit.service';
import { getClientIp } from '../utils/ip';
import type { CreateConnectionInput, UpdateConnectionInput } from '../schemas/connection.schemas';

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const data = req.body as CreateConnectionInput;
    const result = await connectionService.createConnection(req.user.userId, data, req.user.tenantId);
    auditService.log({
      userId: req.user.userId, action: 'CREATE_CONNECTION',
      targetType: 'Connection', targetId: result.id,
      details: { name: data.name, type: data.type, host: data.host, teamId: data.teamId ?? null },
      ipAddress: getClientIp(req),
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const data = req.body as UpdateConnectionInput;
    const result = await connectionService.updateConnection(
      req.user.userId,
      req.params.id as string,
      data,
      req.user.tenantId
    );
    auditService.log({
      userId: req.user.userId, action: 'UPDATE_CONNECTION',
      targetType: 'Connection', targetId: req.params.id as string,
      details: { fields: Object.keys(data) },
      ipAddress: getClientIp(req),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const result = await connectionService.deleteConnection(req.user.userId, req.params.id as string, req.user.tenantId);
    auditService.log({
      userId: req.user.userId, action: 'DELETE_CONNECTION',
      targetType: 'Connection', targetId: req.params.id as string,
      ipAddress: getClientIp(req),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getOne(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const result = await connectionService.getConnection(req.user.userId, req.params.id as string, req.user.tenantId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const result = await connectionService.listConnections(req.user.userId, req.user.tenantId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function toggleFavorite(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const result = await connectionService.toggleFavorite(req.user.userId, req.params.id as string, req.user.tenantId);

    auditService.log({
      userId: req.user.userId,
      action: 'CONNECTION_FAVORITE',
      targetType: 'Connection',
      targetId: req.params.id as string,
      details: { isFavorite: result.isFavorite },
      ipAddress: getClientIp(req),
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
}
