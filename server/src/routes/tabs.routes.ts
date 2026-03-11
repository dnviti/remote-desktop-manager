import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { syncTabsSchema } from '../schemas/tabs.schemas';
import * as tabsController from '../controllers/tabs.controller';

const router = Router();

router.use(authenticate);
router.get('/', tabsController.getTabs);
router.put('/', validate(syncTabsSchema), tabsController.syncTabs);
router.delete('/', tabsController.clearTabs);

export default router;
