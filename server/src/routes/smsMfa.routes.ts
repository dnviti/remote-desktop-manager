import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { smsRateLimiter } from '../middleware/smsRateLimit.middleware';
import { validate } from '../middleware/validate.middleware';
import { setupPhoneSchema, totpCodeSchema } from '../schemas/mfa.schemas';
import * as smsMfaController from '../controllers/smsMfa.controller';

const router = Router();
router.use(authenticate);

router.post('/setup-phone', smsRateLimiter, validate(setupPhoneSchema, 'body', 'Invalid phone number format'), smsMfaController.setupPhone);
router.post('/verify-phone', validate(totpCodeSchema, 'body', 'Invalid code format'), smsMfaController.verifyPhone);
router.post('/enable', smsMfaController.enable);
router.post('/send-disable-code', smsRateLimiter, smsMfaController.sendDisableCode);
router.post('/disable', validate(totpCodeSchema, 'body', 'Invalid code format'), smsMfaController.disable);
router.get('/status', smsMfaController.status);

export default router;
