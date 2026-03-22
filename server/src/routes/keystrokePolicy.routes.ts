import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireTenant, requireTenantRole } from '../middleware/tenant.middleware';
import { validate, validateUuidParam } from '../middleware/validate.middleware';
import { createKeystrokePolicySchema, updateKeystrokePolicySchema } from '../schemas/keystrokePolicy.schemas';
import * as keystrokePolicyController from '../controllers/keystrokePolicy.controller';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

router.use(authenticate);
router.use(requireTenant);
router.use(requireTenantRole('ADMIN'));

router.get('/', asyncHandler(keystrokePolicyController.list));
router.get('/:id', validateUuidParam(), asyncHandler(keystrokePolicyController.get));
router.post('/', validate(createKeystrokePolicySchema), asyncHandler(keystrokePolicyController.create));
router.put('/:id', validateUuidParam(), validate(updateKeystrokePolicySchema), asyncHandler(keystrokePolicyController.update));
router.delete('/:id', validateUuidParam(), asyncHandler(keystrokePolicyController.remove));

export default router;
