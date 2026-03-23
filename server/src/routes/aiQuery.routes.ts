import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireTenant, requireTenantRoleAny } from '../middleware/tenant.middleware';
import { asyncHandler } from '../middleware/asyncHandler';
import * as aiQueryController from '../controllers/aiQuery.controller';

const router = Router();

router.use(authenticate);
router.use(requireTenant);

// GET /api/ai/config — Returns tenant AI config (API key redacted). Requires ADMIN or OWNER.
router.get(
  '/config',
  requireTenantRoleAny('ADMIN', 'OWNER'),
  asyncHandler(aiQueryController.getConfig),
);

// PUT /api/ai/config — Updates tenant AI config. Requires OWNER.
router.put(
  '/config',
  requireTenantRoleAny('OWNER'),
  asyncHandler(aiQueryController.updateConfig),
);

// POST /api/ai/generate-query — Generate SQL from natural language. Any authenticated tenant member.
router.post(
  '/generate-query',
  asyncHandler(aiQueryController.generateQuery),
);

export default router;
