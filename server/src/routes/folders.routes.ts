import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { validate, validateUuidParam } from '../middleware/validate.middleware';
import { createFolderSchema, updateFolderSchema } from '../schemas/folder.schemas';
import * as foldersController from '../controllers/folders.controller';

const router = Router();

router.use(authenticate);
router.get('/', foldersController.list);
router.post('/', validate(createFolderSchema), foldersController.create);
router.put('/:id', validateUuidParam(), validate(updateFolderSchema), foldersController.update);
router.delete('/:id', validateUuidParam(), foldersController.remove);

export default router;
