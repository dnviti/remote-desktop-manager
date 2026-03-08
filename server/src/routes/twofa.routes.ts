import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import * as twofaController from '../controllers/twofa.controller';

const router = Router();
router.use(authenticate);

router.post('/setup', twofaController.setup);
router.post('/verify', twofaController.verify);
router.post('/disable', twofaController.disable);
router.get('/status', twofaController.status);

export default router;
