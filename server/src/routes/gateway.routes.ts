import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireTenant, requireTenantRole } from '../middleware/tenant.middleware';
import { validate, validateUuidParam } from '../middleware/validate.middleware';
import {
  createGatewaySchema, updateGatewaySchema, scaleSchema, scalingConfigSchema,
  rotationPolicySchema, createTemplateSchema, updateTemplateSchema,
} from '../schemas/gateway.schemas';
import * as gatewayController from '../controllers/gateway.controller';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

router.use(authenticate);
router.use(requireTenant);

router.get('/', asyncHandler(gatewayController.list));
router.post('/', requireTenantRole('OPERATOR'), validate(createGatewaySchema), asyncHandler(gatewayController.create));

// SSH key pair management (must be before /:id routes)
router.post('/ssh-keypair', requireTenantRole('OPERATOR'), asyncHandler(gatewayController.generateSshKeyPair));
router.get('/ssh-keypair', requireTenantRole('OPERATOR'), asyncHandler(gatewayController.getSshPublicKey));
router.get('/ssh-keypair/private', requireTenantRole('OPERATOR'), asyncHandler(gatewayController.downloadSshPrivateKey));
router.post('/ssh-keypair/rotate', requireTenantRole('OPERATOR'), asyncHandler(gatewayController.rotateSshKeyPair));
router.patch('/ssh-keypair/rotation', requireTenantRole('OPERATOR'), validate(rotationPolicySchema), asyncHandler(gatewayController.updateRotationPolicy));
router.get('/ssh-keypair/rotation', requireTenantRole('OPERATOR'), asyncHandler(gatewayController.getRotationStatus));

// Tunnel fleet overview (must be before /:id routes)
router.get('/tunnel-overview', requireTenantRole('ADMIN'), asyncHandler(gatewayController.tunnelOverview));

// Gateway templates (must be before /:id routes)
router.get('/templates', requireTenantRole('OPERATOR'), asyncHandler(gatewayController.listTemplates));
router.post('/templates', requireTenantRole('OPERATOR'), validate(createTemplateSchema), asyncHandler(gatewayController.createTemplate));
router.put('/templates/:templateId', requireTenantRole('OPERATOR'), validate(updateTemplateSchema), asyncHandler(gatewayController.updateTemplate));
router.delete('/templates/:templateId', requireTenantRole('OPERATOR'), asyncHandler(gatewayController.deleteTemplate));
router.post('/templates/:templateId/deploy', requireTenantRole('OPERATOR'), asyncHandler(gatewayController.deployFromTemplate));

router.put('/:id', requireTenantRole('OPERATOR'), validateUuidParam(), validate(updateGatewaySchema), asyncHandler(gatewayController.update));
router.delete('/:id', requireTenantRole('OPERATOR'), validateUuidParam(), asyncHandler(gatewayController.remove));
router.post('/:id/test', validateUuidParam(), asyncHandler(gatewayController.testConnectivity));
router.post('/:id/push-key', requireTenantRole('OPERATOR'), validateUuidParam(), asyncHandler(gatewayController.pushKey));

// Managed gateway lifecycle
router.post('/:id/deploy', requireTenantRole('OPERATOR'), validateUuidParam(), asyncHandler(gatewayController.deploy));
router.delete('/:id/deploy', requireTenantRole('OPERATOR'), validateUuidParam(), asyncHandler(gatewayController.undeploy));
router.post('/:id/scale', requireTenantRole('OPERATOR'), validateUuidParam(), validate(scaleSchema), asyncHandler(gatewayController.scale));
router.get('/:id/instances', requireTenantRole('OPERATOR'), validateUuidParam(), asyncHandler(gatewayController.listInstances));
router.post('/:id/instances/:instanceId/restart', requireTenantRole('OPERATOR'), validateUuidParam(), asyncHandler(gatewayController.restartInstance));
router.get('/:id/instances/:instanceId/logs', requireTenantRole('OPERATOR'), validateUuidParam(), asyncHandler(gatewayController.getInstanceLogs));

// Auto-scaling configuration
router.get('/:id/scaling', requireTenantRole('OPERATOR'), validateUuidParam(), asyncHandler(gatewayController.getScalingStatus));
router.put('/:id/scaling', requireTenantRole('OPERATOR'), validateUuidParam(), validate(scalingConfigSchema), asyncHandler(gatewayController.updateScalingConfig));

// Zero-trust tunnel token management
router.post('/:id/tunnel-token', requireTenantRole('OPERATOR'), validateUuidParam(), asyncHandler(gatewayController.generateTunnelToken));
router.delete('/:id/tunnel-token', requireTenantRole('OPERATOR'), validateUuidParam(), asyncHandler(gatewayController.revokeTunnelToken));

export default router;
