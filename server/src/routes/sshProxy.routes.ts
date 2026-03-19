import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/asyncHandler';
import * as sshProxyController from '../controllers/sshProxy.controller';

const router = Router();

router.use(authenticate);

// Issue a short-lived token for native SSH proxy authentication
router.post('/token', asyncHandler(sshProxyController.createProxyToken));

// Get SSH proxy server status
router.get('/status', asyncHandler(sshProxyController.proxyStatus));

export default router;
