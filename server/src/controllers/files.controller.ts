import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import * as fileService from '../services/file.service';
import { AppError } from '../middleware/error.middleware';

const fileNameSchema = z.object({
  name: z.string().min(1).max(255),
});

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const files = await fileService.listFiles(req.user!.userId);
    res.json(files);
  } catch (err) {
    next(err);
  }
}

export async function download(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name } = fileNameSchema.parse(req.params);
    const filePath = await fileService.getFilePath(req.user!.userId, name);
    res.download(filePath, name);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function upload(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }
    const files = await fileService.listFiles(req.user!.userId);
    res.status(201).json(files);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name } = fileNameSchema.parse(req.params);
    await fileService.deleteFile(req.user!.userId, name);
    res.json({ deleted: true });
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}
