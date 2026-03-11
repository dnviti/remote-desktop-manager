import { Response, NextFunction } from 'express';
import { AuthRequest, assertAuthenticated } from '../types';
import * as notificationService from '../services/notification.service';
import type { NotificationQueryInput } from '../schemas/notification.schemas';

export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const query = req.query as unknown as NotificationQueryInput;
    const result = await notificationService.listNotifications(
      req.user.userId,
      query.limit,
      query.offset
    );
    res.json(result);
  } catch (err) {
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
