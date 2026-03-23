import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireTenant } from '../middleware/tenant.middleware';
import { asyncHandler } from '../middleware/asyncHandler';
import * as aiQueryController from '../controllers/aiQuery.controller';

const router = Router();

router.use(authenticate);
router.use(requireTenant);

router.post('/optimize-query', asyncHandler(aiQueryController.optimizeQuery));
router.post('/optimize-query/continue', asyncHandler(aiQueryController.continueOptimization));

export default router;
