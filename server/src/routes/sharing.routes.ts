import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { validate, validateUuidParam } from '../middleware/validate.middleware';
import { shareSchema, batchShareSchema, updatePermissionSchema } from '../schemas/sharing.schemas';
import * as sharingController from '../controllers/sharing.controller';

const router = Router();

router.use(authenticate);
router.post('/batch-share', validate(batchShareSchema), sharingController.batchShare);
router.post('/:id/share', validateUuidParam(), validate(shareSchema), sharingController.share);
router.delete('/:id/share/:userId', validateUuidParam(), sharingController.unshare);
router.put('/:id/share/:userId', validateUuidParam(), validate(updatePermissionSchema), sharingController.updatePermission);
router.get('/:id/shares', validateUuidParam(), sharingController.listShares);

export default router;
