import { Response } from 'express';
import { AuthRequest, assertAuthenticated } from '../types';
import * as notificationService from '../services/notification.service';
import { validatedQuery } from '../middleware/validate.middleware';
import type { NotificationQueryInput } from '../schemas/notification.schemas';

export async function list(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const query = validatedQuery<NotificationQueryInput>(req);
  const result = await notificationService.listNotifications(
    req.user.userId,
    query.limit,
    query.offset
  );
  res.json(result);
}

export async function markRead(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  await notificationService.markAsRead(req.params.id as string, req.user.userId);
  res.json({ success: true });
}

export async function markAllRead(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  await notificationService.markAllAsRead(req.user.userId);
  res.json({ success: true });
}

export async function remove(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  await notificationService.deleteNotification(req.params.id as string, req.user.userId);
  res.json({ success: true });
}
