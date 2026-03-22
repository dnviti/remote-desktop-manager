import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validate } from '../middleware/validate.middleware';
import { setupCompleteSchema } from '../schemas/setup.schemas';
import * as setupController from '../controllers/setup.controller';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

const setupRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many setup requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// GET /api/setup/status — Check if setup is required (public, no auth)
router.get('/status', asyncHandler(setupController.getSetupStatus));

// POST /api/setup/complete — Complete initial setup (public, no auth, rate-limited)
router.post(
  '/complete',
  setupRateLimiter,
  validate(setupCompleteSchema),
  asyncHandler(setupController.completeSetup),
);

export default router;
