import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import * as connectionsController from '../controllers/connections.controller';

const router = Router();

router.use(authenticate);
router.get('/', connectionsController.list);
router.post('/', connectionsController.create);
router.get('/:id', connectionsController.getOne);
router.put('/:id', connectionsController.update);
router.delete('/:id', connectionsController.remove);

export default router;
