import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { validate, validateUuidParam } from '../middleware/validate.middleware';
import { notificationQuerySchema } from '../schemas/notification.schemas';
import * as notificationController from '../controllers/notification.controller';

const router = Router();

router.use(authenticate);
router.get('/', validate(notificationQuerySchema, 'query'), notificationController.list);
router.put('/read-all', notificationController.markAllRead);
router.put('/:id/read', validateUuidParam(), notificationController.markRead);
router.delete('/:id', validateUuidParam(), notificationController.remove);

export default router;
