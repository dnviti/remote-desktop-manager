import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import * as vaultController from '../controllers/vault.controller';

const router = Router();

router.use(authenticate);
router.post('/unlock', vaultController.unlock);
router.post('/lock', vaultController.lock);
router.get('/status', vaultController.status);
router.post('/reveal-password', vaultController.revealPassword);

export default router;
