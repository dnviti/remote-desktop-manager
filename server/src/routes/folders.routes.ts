import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import * as foldersController from '../controllers/folders.controller';

const router = Router();

router.use(authenticate);
router.get('/', foldersController.list);
router.post('/', foldersController.create);
router.put('/:id', foldersController.update);
router.delete('/:id', foldersController.remove);

export default router;
