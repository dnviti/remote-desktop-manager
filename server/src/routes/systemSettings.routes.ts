import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireTenantRoleAny } from '../middleware/tenant.middleware';
import { validate } from '../middleware/validate.middleware';
import { updateSettingSchema, bulkUpdateSettingsSchema } from '../schemas/systemSettings.schemas';
import { asyncHandler } from '../middleware/asyncHandler';
import * as controller from '../controllers/systemSettings.controller';

const router = Router();

router.use(authenticate);

// Read: AUDITOR, ADMIN, OWNER
router.get(
  '/',
  requireTenantRoleAny('AUDITOR', 'ADMIN', 'OWNER'),
  asyncHandler(controller.getAllSettings),
);

// Write single: ADMIN, OWNER (per-setting role check in service)
router.put(
  '/:key',
  requireTenantRoleAny('ADMIN', 'OWNER'),
  validate(updateSettingSchema),
  asyncHandler(controller.updateSetting),
);

// Write bulk: ADMIN, OWNER (per-setting role check in service)
router.put(
  '/',
  requireTenantRoleAny('ADMIN', 'OWNER'),
  validate(bulkUpdateSettingsSchema),
  asyncHandler(controller.bulkUpdateSettings),
);

export default router;
