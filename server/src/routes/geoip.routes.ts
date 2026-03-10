import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import * as geoipController from '../controllers/geoip.controller';

const router = Router();

router.use(authenticate);
router.get('/:ip', geoipController.lookupIp);

export default router;
