import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { smsRateLimiter } from '../middleware/smsRateLimit.middleware';
import * as smsMfaController from '../controllers/smsMfa.controller';

const router = Router();
router.use(authenticate);

router.post('/setup-phone', smsRateLimiter, smsMfaController.setupPhone);
router.post('/verify-phone', smsMfaController.verifyPhone);
router.post('/enable', smsMfaController.enable);
router.post('/send-disable-code', smsRateLimiter, smsMfaController.sendDisableCode);
router.post('/disable', smsMfaController.disable);
router.get('/status', smsMfaController.status);

export default router;
