import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireTenantRole } from '../middleware/tenant.middleware';
import { validate } from '../middleware/validate.middleware';
import { testEmailSchema, selfSignupSchema } from '../schemas/admin.schemas';
import * as adminController from '../controllers/admin.controller';

const router = Router();

router.use(authenticate);

router.get('/email/status', requireTenantRole('ADMIN'), adminController.emailStatus);
router.post('/email/test', requireTenantRole('ADMIN'), validate(testEmailSchema), adminController.sendTestEmail);
router.get('/app-config', requireTenantRole('ADMIN'), adminController.getAppConfig);
router.put('/app-config/self-signup', requireTenantRole('ADMIN'), validate(selfSignupSchema), adminController.setSelfSignup);

export default router;
