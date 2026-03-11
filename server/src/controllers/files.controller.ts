import { Response, NextFunction } from 'express';
import { AuthRequest, assertAuthenticated } from '../types';
import * as fileService from '../services/file.service';
import { AppError } from '../middleware/error.middleware';
import type { FileNameInput } from '../schemas/files.schemas';

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const files = await fileService.listFiles(req.user.userId);
    res.json(files);
  } catch (err) {
    next(err);
  }
}

export async function download(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { name } = req.params as FileNameInput;
    const filePath = await fileService.getFilePath(req.user.userId, name);
    res.download(filePath, name);
  } catch (err) {
    next(err);
  }
}

export async function upload(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }
    const files = await fileService.listFiles(req.user.userId);
    res.status(201).json(files);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { name } = req.params as FileNameInput;
    await fileService.deleteFile(req.user.userId, name);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
}
