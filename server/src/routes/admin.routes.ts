import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/auth.middleware';
import { requireVerifiedRole } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { testEmailSchema, selfSignupSchema } from '../schemas/admin.schemas';
import { asyncHandler } from '../middleware/asyncHandler';
import * as adminController from '../controllers/admin.controller';

const router = Router();

const emailTestRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  message: { error: 'Too many email test requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(authenticate);

router.get('/email/status', requireVerifiedRole('ADMIN'), asyncHandler(adminController.emailStatus));
router.post('/email/test', emailTestRateLimiter, requireVerifiedRole('ADMIN'), validate(testEmailSchema), adminController.sendTestEmail);
router.get('/app-config', requireVerifiedRole('ADMIN'), asyncHandler(adminController.getAppConfig));
router.put('/app-config/self-signup', requireVerifiedRole('ADMIN'), validate(selfSignupSchema), asyncHandler(adminController.setSelfSignup));
router.get('/auth-providers', requireVerifiedRole('ADMIN'), asyncHandler(adminController.getProviderDetails));

export default router;
