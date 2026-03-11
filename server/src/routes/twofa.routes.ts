import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { totpCodeSchema } from '../schemas/mfa.schemas';
import * as twofaController from '../controllers/twofa.controller';

const router = Router();
router.use(authenticate);

router.post('/setup', twofaController.setup);
router.post('/verify', validate(totpCodeSchema, 'body', 'Invalid code format'), twofaController.verify);
router.post('/disable', validate(totpCodeSchema, 'body', 'Invalid code format'), twofaController.disable);
router.get('/status', twofaController.status);

export default router;
