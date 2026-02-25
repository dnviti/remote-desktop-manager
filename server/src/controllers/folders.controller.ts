import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import * as folderService from '../services/folder.service';
import { AppError } from '../middleware/error.middleware';

const createSchema = z.object({
  name: z.string().min(1),
  parentId: z.string().uuid().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  parentId: z.string().uuid().nullable().optional(),
});

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, parentId } = createSchema.parse(req.body);
    const result = await folderService.createFolder(req.user!.userId, name, parentId);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.errors[0].message, 400));
    next(err);
  }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = updateSchema.parse(req.body);
    const result = await folderService.updateFolder(req.user!.userId, req.params.id as string, data);
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.errors[0].message, 400));
    next(err);
  }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await folderService.deleteFolder(req.user!.userId, req.params.id as string);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await folderService.getFolderTree(req.user!.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
