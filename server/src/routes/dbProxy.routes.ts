import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireTenant } from '../middleware/tenant.middleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { sessionRateLimiter } from '../middleware/sessionRateLimit.middleware';
import * as dbProxyController from '../controllers/dbProxy.controller';

const router = Router();

router.use(authenticate);
router.use(requireTenant);

// Database proxy session lifecycle
router.post('/', sessionRateLimiter, asyncHandler(dbProxyController.createSession));
router.post('/:sessionId/end', asyncHandler(dbProxyController.endSession));
router.post('/:sessionId/heartbeat', asyncHandler(dbProxyController.heartbeat));
router.post('/:sessionId/query', asyncHandler(dbProxyController.executeQuery));
router.get('/:sessionId/schema', asyncHandler(dbProxyController.getSchema));

export default router;
