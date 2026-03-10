import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest, assertAuthenticated } from '../types';
import * as notificationService from '../services/notification.service';
import { AppError } from '../middleware/error.middleware';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const query = querySchema.parse(req.query);
    const result = await notificationService.listNotifications(
      req.user.userId,
      query.limit,
      query.offset
    );
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function markRead(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    await notificationService.markAsRead(req.params.id as string, req.user.userId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

export async function markAllRead(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    await notificationService.markAllAsRead(req.user.userId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    await notificationService.deleteNotification(req.params.id as string, req.user.userId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}
