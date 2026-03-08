import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import * as tabsController from '../controllers/tabs.controller';

const router = Router();

router.use(authenticate);
router.get('/', tabsController.getTabs);
router.put('/', tabsController.syncTabs);
router.delete('/', tabsController.clearTabs);

export default router;
