import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireTenant, requireTenantRoleAny } from '../middleware/tenant.middleware';
import { asyncHandler } from '../middleware/asyncHandler';
import * as rdGatewayController from '../controllers/rdGateway.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

// --- Configuration (admin only) ---
router.get(
  '/config',
  requireTenant,
  requireTenantRoleAny('ADMIN', 'OWNER'),
  asyncHandler(rdGatewayController.getConfig),
);
router.put(
  '/config',
  requireTenant,
  requireTenantRoleAny('ADMIN', 'OWNER'),
  asyncHandler(rdGatewayController.updateConfig),
);

// --- Status (admin/operator) ---
router.get(
  '/status',
  requireTenant,
  requireTenantRoleAny('ADMIN', 'OWNER', 'OPERATOR'),
  asyncHandler(rdGatewayController.getGatewayStatus),
);

// --- .rdp file generation ---
router.get(
  '/connections/:connectionId/rdpfile',
  asyncHandler(rdGatewayController.generateRdpFile),
);

export default router;
