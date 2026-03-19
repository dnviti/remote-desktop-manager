import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { sessionRateLimiter } from '../middleware/sessionRateLimit.middleware';
import * as dbProxyController from '../controllers/dbProxy.controller';

const router = Router();

router.use(authenticate);

// Database proxy session lifecycle
router.post('/', sessionRateLimiter, asyncHandler(dbProxyController.createSession));
router.post('/:sessionId/end', asyncHandler(dbProxyController.endSession));

export default router;
