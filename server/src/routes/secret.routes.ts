import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import * as secretController from '../controllers/secret.controller';
import * as externalShareController from '../controllers/externalShare.controller';

const router = Router();

router.use(authenticate);

// Tenant vault management (before /:id to avoid param collision)
router.post('/tenant-vault/init', secretController.initTenantVault);
router.post('/tenant-vault/distribute', secretController.distributeTenantKey);
router.get('/tenant-vault/status', secretController.tenantVaultStatus);

// External share revoke (before /:id to avoid param collision)
router.delete('/external-shares/:shareId', externalShareController.revoke);

// CRUD
router.get('/', secretController.list);
router.post('/', secretController.create);
router.get('/:id', secretController.getOne);
router.put('/:id', secretController.update);
router.delete('/:id', secretController.remove);

// Versions
router.get('/:id/versions', secretController.listVersions);
router.get('/:id/versions/:version/data', secretController.getVersionData);
router.post('/:id/versions/:version/restore', secretController.restoreVersion);

// Sharing
router.post('/:id/share', secretController.share);
router.delete('/:id/share/:userId', secretController.unshare);
router.put('/:id/share/:userId', secretController.updateSharePermission);
router.get('/:id/shares', secretController.listShares);

// External sharing
router.post('/:id/external-shares', externalShareController.create);
router.get('/:id/external-shares', externalShareController.list);

export default router;
