import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import * as sharingController from '../controllers/sharing.controller';

const router = Router();

router.use(authenticate);
router.post('/:id/share', sharingController.share);
router.delete('/:id/share/:userId', sharingController.unshare);
router.put('/:id/share/:userId', sharingController.updatePermission);
router.get('/:id/shares', sharingController.listShares);

export default router;
