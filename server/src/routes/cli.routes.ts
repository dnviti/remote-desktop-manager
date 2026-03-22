import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/asyncHandler';
import * as cliController from '../controllers/cli.controller';

const router = Router();

// Rate limit device auth initiation (prevents abuse)
const deviceAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many device authorization requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limit device token polling (RFC 8628 recommends server-side enforcement)
const devicePollLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'slow_down', error_description: 'Polling too frequently' },
  standardHeaders: true,
  legacyHeaders: false,
});

// --- Device Authorization (no auth required) ---
router.post('/auth/device', deviceAuthLimiter, asyncHandler(cliController.initiateDeviceAuth));
router.post('/auth/device/token', devicePollLimiter, asyncHandler(cliController.pollDeviceToken));

// --- Device Authorization approval (auth required — called from web UI) ---
router.post('/auth/device/authorize', authenticate, asyncHandler(cliController.authorizeDevice));

// --- Authenticated CLI endpoints ---
router.get('/connections', authenticate, asyncHandler(cliController.listConnections));

export default router;
