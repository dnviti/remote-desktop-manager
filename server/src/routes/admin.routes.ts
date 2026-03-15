import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireTenantRole } from '../middleware/tenant.middleware';
import { validate } from '../middleware/validate.middleware';
import { testEmailSchema, selfSignupSchema } from '../schemas/admin.schemas';
import { asyncHandler } from '../middleware/asyncHandler';
import * as adminController from '../controllers/admin.controller';

const router = Router();

router.use(authenticate);

router.get('/email/status', requireTenantRole('ADMIN'), asyncHandler(adminController.emailStatus));
router.post('/email/test', requireTenantRole('ADMIN'), validate(testEmailSchema), adminController.sendTestEmail);
router.get('/app-config', requireTenantRole('ADMIN'), asyncHandler(adminController.getAppConfig));
router.put('/app-config/self-signup', requireTenantRole('ADMIN'), validate(selfSignupSchema), asyncHandler(adminController.setSelfSignup));
router.get('/auth-providers', requireTenantRole('ADMIN'), asyncHandler(adminController.getProviderDetails));

export default router;
