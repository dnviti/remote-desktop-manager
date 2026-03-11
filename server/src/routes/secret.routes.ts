import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { validate, validateUuidParam } from '../middleware/validate.middleware';
import { createSecretSchema, updateSecretSchema, listFiltersSchema, shareSecretSchema, updateSharePermSchema, distributeTenantKeySchema } from '../schemas/secret.schemas';
import { createExternalShareSchema } from '../schemas/externalShare.schemas';
import * as secretController from '../controllers/secret.controller';
import * as externalShareController from '../controllers/externalShare.controller';

const router = Router();

router.use(authenticate);

// Tenant vault management (before /:id to avoid param collision)
router.post('/tenant-vault/init', secretController.initTenantVault);
router.post('/tenant-vault/distribute', validate(distributeTenantKeySchema), secretController.distributeTenantKey);
router.get('/tenant-vault/status', secretController.tenantVaultStatus);

// External share revoke (before /:id to avoid param collision)
router.delete('/external-shares/:shareId', externalShareController.revoke);

// CRUD
router.get('/', validate(listFiltersSchema, 'query'), secretController.list);
router.post('/', validate(createSecretSchema), secretController.create);
router.get('/:id', validateUuidParam(), secretController.getOne);
router.put('/:id', validateUuidParam(), validate(updateSecretSchema), secretController.update);
router.delete('/:id', validateUuidParam(), secretController.remove);

// Versions
router.get('/:id/versions', validateUuidParam(), secretController.listVersions);
router.get('/:id/versions/:version/data', validateUuidParam(), secretController.getVersionData);
router.post('/:id/versions/:version/restore', validateUuidParam(), secretController.restoreVersion);

// Sharing
router.post('/:id/share', validateUuidParam(), validate(shareSecretSchema), secretController.share);
router.delete('/:id/share/:userId', validateUuidParam(), secretController.unshare);
router.put('/:id/share/:userId', validateUuidParam(), validate(updateSharePermSchema), secretController.updateSharePermission);
router.get('/:id/shares', validateUuidParam(), secretController.listShares);

// External sharing
router.post('/:id/external-shares', validateUuidParam(), validate(createExternalShareSchema), externalShareController.create);
router.get('/:id/external-shares', validateUuidParam(), externalShareController.list);

export default router;
