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
router.patch('/ssh-keypair/rotation', requireTenantRole('ADMIN'), gatewayController.updateRotationPolicy);
router.get('/ssh-keypair/rotation', requireTenantRole('ADMIN'), gatewayController.getRotationStatus);

// Gateway templates (must be before /:id routes)
router.get('/templates', requireTenantRole('ADMIN'), gatewayController.listTemplates);
router.post('/templates', requireTenantRole('ADMIN'), gatewayController.createTemplate);
router.put('/templates/:templateId', requireTenantRole('ADMIN'), gatewayController.updateTemplate);
router.delete('/templates/:templateId', requireTenantRole('ADMIN'), gatewayController.deleteTemplate);
router.post('/templates/:templateId/deploy', requireTenantRole('ADMIN'), gatewayController.deployFromTemplate);

router.put('/:id', requireTenantRole('ADMIN'), gatewayController.update);
router.delete('/:id', requireTenantRole('ADMIN'), gatewayController.remove);
router.post('/:id/test', gatewayController.testConnectivity);
router.post('/:id/push-key', requireTenantRole('ADMIN'), gatewayController.pushKey);

// Managed gateway lifecycle
router.post('/:id/deploy', requireTenantRole('ADMIN'), gatewayController.deploy);
router.delete('/:id/deploy', requireTenantRole('ADMIN'), gatewayController.undeploy);
router.post('/:id/scale', requireTenantRole('ADMIN'), gatewayController.scale);
router.get('/:id/instances', requireTenantRole('ADMIN'), gatewayController.listInstances);
router.post('/:id/instances/:instanceId/restart', requireTenantRole('ADMIN'), gatewayController.restartInstance);
router.get('/:id/instances/:instanceId/logs', requireTenantRole('ADMIN'), gatewayController.getInstanceLogs);

// Auto-scaling configuration
router.get('/:id/scaling', requireTenantRole('ADMIN'), gatewayController.getScalingStatus);
router.put('/:id/scaling', requireTenantRole('ADMIN'), gatewayController.updateScalingConfig);

export default router;
