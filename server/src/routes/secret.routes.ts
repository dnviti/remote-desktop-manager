import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { validate, validateUuidParam } from '../middleware/validate.middleware';
import { createSecretSchema, updateSecretSchema, listFiltersSchema, shareSecretSchema, updateSharePermSchema, distributeTenantKeySchema } from '../schemas/secret.schemas';
import { createExternalShareSchema } from '../schemas/externalShare.schemas';
import * as secretController from '../controllers/secret.controller';
import * as externalShareController from '../controllers/externalShare.controller';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

router.use(authenticate);

// Tenant vault management (before /:id to avoid param collision)
router.post('/tenant-vault/init', asyncHandler(secretController.initTenantVault));
router.post('/tenant-vault/distribute', validate(distributeTenantKeySchema), asyncHandler(secretController.distributeTenantKey));
router.get('/tenant-vault/status', asyncHandler(secretController.tenantVaultStatus));

// Breach check — batch (before /:id to avoid param collision)
router.post('/breach-check', asyncHandler(secretController.checkAllBreaches));

// External share revoke (before /:id to avoid param collision)
router.delete('/external-shares/:shareId', asyncHandler(externalShareController.revoke));

// CRUD
router.get('/', validate(listFiltersSchema, 'query'), asyncHandler(secretController.list));
router.post('/', validate(createSecretSchema), asyncHandler(secretController.create));
router.get('/:id', validateUuidParam(), asyncHandler(secretController.getOne));
router.put('/:id', validateUuidParam(), validate(updateSecretSchema), asyncHandler(secretController.update));
router.delete('/:id', validateUuidParam(), asyncHandler(secretController.remove));

// Breach check — single secret
router.post('/:id/breach-check', validateUuidParam(), asyncHandler(secretController.checkBreach));

// Versions
router.get('/:id/versions', validateUuidParam(), asyncHandler(secretController.listVersions));
router.get('/:id/versions/:version/data', validateUuidParam(), asyncHandler(secretController.getVersionData));
router.post('/:id/versions/:version/restore', validateUuidParam(), asyncHandler(secretController.restoreVersion));

// Sharing
router.post('/:id/share', validateUuidParam(), validate(shareSecretSchema), asyncHandler(secretController.share));
router.delete('/:id/share/:userId', validateUuidParam(), asyncHandler(secretController.unshare));
router.put('/:id/share/:userId', validateUuidParam(), validate(updateSharePermSchema), asyncHandler(secretController.updateSharePermission));
router.get('/:id/shares', validateUuidParam(), asyncHandler(secretController.listShares));

// External sharing
router.post('/:id/external-shares', validateUuidParam(), validate(createExternalShareSchema), asyncHandler(externalShareController.create));
router.get('/:id/external-shares', validateUuidParam(), asyncHandler(externalShareController.list));

export default router;
