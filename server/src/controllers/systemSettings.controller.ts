import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../types';
import { assertTenantAuthenticated } from '../types';
import * as systemSettingsService from '../services/systemSettings.service';
import { SETTINGS_REGISTRY } from '../services/systemSettings.service';
import * as setupService from '../services/setup.service';
import * as auditService from '../services/audit.service';
import { getClientIp } from '../utils/ip';

export async function getAllSettings(req: AuthRequest, res: Response, _next: NextFunction) {
  assertTenantAuthenticated(req);
  const settings = await systemSettingsService.getAllSettings(req.user.tenantRole);
  const groups = systemSettingsService.SETTING_GROUPS;
  res.json({ settings, groups });
}

export async function updateSetting(req: AuthRequest, res: Response, _next: NextFunction) {
  assertTenantAuthenticated(req);
  const key = String(req.params.key);
  const { value } = req.body;

  const result = await systemSettingsService.setSetting(key, value, req.user.tenantRole);

  const def = SETTINGS_REGISTRY.find(d => d.key === key);
  auditService.log({
    userId: req.user.userId,
    action: 'APP_CONFIG_UPDATE',
    targetType: 'system_setting',
    targetId: key,
    details: { key, value: def?.sensitive ? '[REDACTED]' : value },
    ipAddress: getClientIp(req),
  });

  res.json(result);
}

export async function bulkUpdateSettings(req: AuthRequest, res: Response, _next: NextFunction) {
  assertTenantAuthenticated(req);
  const { updates } = req.body;

  const results = await systemSettingsService.setSettings(updates, req.user.tenantRole);

  for (const r of results) {
    if (r.success) {
      const update = updates.find((u: { key: string }) => u.key === r.key);
      const def = SETTINGS_REGISTRY.find(d => d.key === r.key);
      auditService.log({
        userId: req.user.userId,
        action: 'APP_CONFIG_UPDATE',
        targetType: 'system_setting',
        targetId: r.key,
        details: { key: r.key, value: def?.sensitive ? '[REDACTED]' : update?.value },
        ipAddress: getClientIp(req),
      });
    }
  }

  res.json({ results });
}

export async function getDbStatus(_req: AuthRequest, res: Response, _next: NextFunction) {
  const status = await setupService.getDbStatus();
  res.json(status);
}
