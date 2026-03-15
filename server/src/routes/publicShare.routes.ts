import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validate } from '../middleware/validate.middleware';
import { accessExternalShareSchema } from '../schemas/externalShare.schemas';
import * as externalShareController from '../controllers/externalShare.controller';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

const shareAccessLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  message: { error: 'Too many access attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Public endpoints — no authentication required
router.get('/:token/info', shareAccessLimiter, asyncHandler(externalShareController.getInfo));
router.post('/:token', shareAccessLimiter, validate(accessExternalShareSchema), asyncHandler(externalShareController.access));

export default router;
