import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireTenant, requireTenantRole } from '../middleware/tenant.middleware';
import { validate, validateUuidParam } from '../middleware/validate.middleware';
import { createAccessPolicySchema, updateAccessPolicySchema } from '../schemas/accessPolicy.schemas';
import * as accessPolicyController from '../controllers/accessPolicy.controller';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

router.use(authenticate);
router.use(requireTenant);
router.use(requireTenantRole('ADMIN'));

router.get('/', asyncHandler(accessPolicyController.list));
router.post('/', validate(createAccessPolicySchema), asyncHandler(accessPolicyController.create));
router.put('/:id', validateUuidParam(), validate(updateAccessPolicySchema), asyncHandler(accessPolicyController.update));
router.delete('/:id', validateUuidParam(), asyncHandler(accessPolicyController.remove));

export default router;
