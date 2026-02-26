import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import * as connectionService from '../services/connection.service';
import { AppError } from '../middleware/error.middleware';

const createSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['RDP', 'SSH']),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  username: z.string(),
  password: z.string(),
  description: z.string().optional(),
  folderId: z.string().uuid().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(['RDP', 'SSH']).optional(),
  host: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  description: z.string().nullable().optional(),
  folderId: z.string().uuid().nullable().optional(),
});

export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = createSchema.parse(req.body);
    const result = await connectionService.createConnection(req.user!.userId, data);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.errors[0].message, 400));
    next(err);
  }
}

export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const data = updateSchema.parse(req.body);
    const result = await connectionService.updateConnection(
      req.user!.userId,
      req.params.id as string,
      data
    );
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.errors[0].message, 400));
    next(err);
  }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await connectionService.deleteConnection(req.user!.userId, req.params.id as string);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getOne(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await connectionService.getConnection(req.user!.userId, req.params.id as string);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await connectionService.listConnections(req.user!.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
