import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { ipParamSchema } from '../schemas/geoip.schemas';
import * as geoipController from '../controllers/geoip.controller';

const router = Router();

router.use(authenticate);
router.get('/:ip', validate(ipParamSchema, 'params'), geoipController.lookupIp);

export default router;
