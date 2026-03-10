import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest, assertAuthenticated } from '../types';
import * as tabsService from '../services/tabs.service';
import { AppError } from '../middleware/error.middleware';

const syncSchema = z.object({
  tabs: z.array(
    z.object({
      connectionId: z.string().uuid(),
      sortOrder: z.number().int().min(0),
      isActive: z.boolean(),
    }),
  ).max(50),
});

export async function getTabs(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const result = await tabsService.getUserTabs(req.user.userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function syncTabs(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    const { tabs } = syncSchema.parse(req.body);
    const result = await tabsService.syncTabs(req.user.userId, tabs, req.user.tenantId);
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(new AppError(err.issues[0].message, 400));
    next(err);
  }
}

export async function clearTabs(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    assertAuthenticated(req);
    await tabsService.clearUserTabs(req.user.userId);
    res.json({ cleared: true });
  } catch (err) {
    next(err);
  }
}
