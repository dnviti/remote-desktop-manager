import { Response, NextFunction } from 'express';
import { AuthRequest, assertAuthenticated } from '../types';
import * as tabsService from '../services/tabs.service';
import type { SyncTabsInput } from '../schemas/tabs.schemas';

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
    const { tabs } = req.body as SyncTabsInput;
    const result = await tabsService.syncTabs(req.user.userId, tabs, req.user.tenantId);
    res.json(result);
  } catch (err) {
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
