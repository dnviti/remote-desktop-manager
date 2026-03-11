import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { validate, validateUuidParam } from '../middleware/validate.middleware';
import { createConnectionSchema, updateConnectionSchema } from '../schemas/connection.schemas';
import * as connectionsController from '../controllers/connections.controller';

const router = Router();

router.use(authenticate);
router.get('/', connectionsController.list);
router.post('/', validate(createConnectionSchema), connectionsController.create);
router.get('/:id', validateUuidParam(), connectionsController.getOne);
router.put('/:id', validateUuidParam(), validate(updateConnectionSchema), connectionsController.update);
router.delete('/:id', validateUuidParam(), connectionsController.remove);
router.patch('/:id/favorite', validateUuidParam(), connectionsController.toggleFavorite);

export default router;
