import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as externalShareController from '../controllers/externalShare.controller';

const router = Router();

const shareAccessLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  message: { error: 'Too many access attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Public endpoints — no authentication required
router.get('/:token/info', externalShareController.getInfo);
router.post('/:token', shareAccessLimiter, externalShareController.access);

export default router;
