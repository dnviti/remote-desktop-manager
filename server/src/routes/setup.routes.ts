import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { validate } from '../middleware/validate.middleware';
import { setupCompleteSchema } from '../schemas/setup.schemas';
import * as setupController from '../controllers/setup.controller';
import * as setupService from '../services/setup.service';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

const setupRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many setup requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/** Reject requests if setup is already completed (before validation runs). */
const rejectIfSetupDone = asyncHandler(async (_req: Request, res: Response, next: NextFunction) => {
  const required = await setupService.isSetupRequired();
  if (!required) {
    res.status(409).json({ error: 'Setup has already been completed' });
    return;
  }
  next();
});

// GET /api/setup/status — Check if setup is required (public, no auth)
router.get('/status', asyncHandler(setupController.getSetupStatus));

// GET /api/setup/db-status — Database connection status (public, no auth)
router.get('/db-status', asyncHandler(setupController.getDbStatus));

// POST /api/setup/complete — Complete initial setup (public, no auth, rate-limited)
router.post(
  '/complete',
  setupRateLimiter,
  rejectIfSetupDone,
  validate(setupCompleteSchema),
  asyncHandler(setupController.completeSetup),
);

export default router;
