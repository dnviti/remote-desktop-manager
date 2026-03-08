import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireTenantRole } from '../middleware/tenant.middleware';
import * as adminController from '../controllers/admin.controller';

const router = Router();

router.use(authenticate);

router.get('/email/status', requireTenantRole('ADMIN'), adminController.emailStatus);
router.post('/email/test', requireTenantRole('ADMIN'), adminController.sendTestEmail);
router.get('/app-config', requireTenantRole('ADMIN'), adminController.getAppConfig);
router.put('/app-config/self-signup', requireTenantRole('ADMIN'), adminController.setSelfSignup);

export default router;
