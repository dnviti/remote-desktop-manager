import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireTenant, requireTenantRole } from '../middleware/tenant.middleware';
import * as gatewayController from '../controllers/gateway.controller';

const router = Router();

router.use(authenticate);
router.use(requireTenant);

router.get('/', gatewayController.list);
router.post('/', requireTenantRole('ADMIN'), gatewayController.create);

// SSH key pair management (must be before /:id routes)
router.post('/ssh-keypair', requireTenantRole('ADMIN'), gatewayController.generateSshKeyPair);
router.get('/ssh-keypair', requireTenantRole('ADMIN'), gatewayController.getSshPublicKey);
router.get('/ssh-keypair/private', requireTenantRole('ADMIN'), gatewayController.downloadSshPrivateKey);
router.post('/ssh-keypair/rotate', requireTenantRole('ADMIN'), gatewayController.rotateSshKeyPair);

router.put('/:id', requireTenantRole('ADMIN'), gatewayController.update);
router.delete('/:id', requireTenantRole('ADMIN'), gatewayController.remove);
router.post('/:id/test', gatewayController.testConnectivity);
router.post('/:id/push-key', requireTenantRole('ADMIN'), gatewayController.pushKey);

export default router;
