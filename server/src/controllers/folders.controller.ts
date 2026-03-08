import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import * as folderService from '../services/folder.service';
import * as auditService from '../services/audit.service';
import { AppError } from '../middleware/error.middleware';

const createSchema = z.object({
  name: z.string().min(1),
  parentId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  parentId: z.string().uuid().nullable().optional(),
});

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, parentId, teamId } = createSchema.parse(req.body);
    const result = await folderService.createFolder(req.user!.userId, name, parentId, teamId, req.user!.tenantId);
    auditService.log({
      userId: req.user!.userId, action: 'CREATE_FOLDER',
      targetType: 'Folder', targetId: result.id,
      details: { name, teamId: teamId ?? null },
      ipAddress: req.ip,
    });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = updateSchema.parse(req.body);
    const result = await folderService.updateFolder(req.user!.userId, req.params.id as string, data, req.user!.tenantId);
    auditService.log({
      userId: req.user!.userId, action: 'UPDATE_FOLDER',
      targetType: 'Folder', targetId: req.params.id as string,
      details: { fields: Object.keys(data) },
      ipAddress: req.ip,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await folderService.deleteFolder(req.user!.userId, req.params.id as string, req.user!.tenantId);
    auditService.log({
      userId: req.user!.userId, action: 'DELETE_FOLDER',
      targetType: 'Folder', targetId: req.params.id as string,
      ipAddress: req.ip,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await folderService.getFolderTree(req.user!.userId, req.user!.tenantId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
