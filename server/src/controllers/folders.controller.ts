import { Response, NextFunction } from 'express';
import { AuthRequest, assertAuthenticated } from '../types';
import * as folderService from '../services/folder.service';
import * as auditService from '../services/audit.service';
import { getClientIp } from '../utils/ip';
import type { CreateFolderInput, UpdateFolderInput } from '../schemas/folder.schemas';

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { name, parentId, teamId } = req.body as CreateFolderInput;
    const result = await folderService.createFolder(req.user.userId, name, parentId, teamId, req.user.tenantId);
    auditService.log({
      userId: req.user.userId, action: 'CREATE_FOLDER',
      targetType: 'Folder', targetId: result.id,
      details: { name, teamId: teamId ?? null },
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
    const data = req.body as UpdateFolderInput;
    const result = await folderService.updateFolder(req.user.userId, req.params.id as string, data, req.user.tenantId);
    auditService.log({
      userId: req.user.userId, action: 'UPDATE_FOLDER',
      targetType: 'Folder', targetId: req.params.id as string,
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
    const result = await folderService.deleteFolder(req.user.userId, req.params.id as string, req.user.tenantId);
    auditService.log({
      userId: req.user.userId, action: 'DELETE_FOLDER',
      targetType: 'Folder', targetId: req.params.id as string,
      ipAddress: getClientIp(req),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const result = await folderService.getFolderTree(req.user.userId, req.user.tenantId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
