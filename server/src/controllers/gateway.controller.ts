import { Response } from 'express';
import { AuthRequest, assertTenantAuthenticated } from '../types';
import * as gatewayService from '../services/gateway.service';
import { isTunnelConnected } from '../services/tunnel.service';
import * as sshKeyService from '../services/sshkey.service';
import * as managedGatewayService from '../services/managedGateway.service';
import * as autoscalerService from '../services/autoscaler.service';
import * as gatewayTemplateService from '../services/gatewayTemplate.service';
import * as auditService from '../services/audit.service';
import { AppError } from '../middleware/error.middleware';
import prisma from '../lib/prisma';
import { getOrchestrator } from '../orchestrator';
import {
  emitInstancesForGateway,
  emitScalingForGateway,
  emitGatewayData,
} from '../services/gatewayMonitor.service';
import { getClientIp } from '../utils/ip';
import type { CreateGatewayInput, UpdateGatewayInput, ScaleInput, ScalingConfigInput, RotationPolicyInput, CreateTemplateInput, UpdateTemplateInput } from '../schemas/gateway.schemas';

export async function list(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const result = await gatewayService.listGateways(req.user.tenantId);
  res.json(result);
}

export async function create(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const data = req.body as CreateGatewayInput;
  const result = await gatewayService.createGateway(
    req.user.userId,
    req.user.tenantId,
    data,
  );
  auditService.log({
    userId: req.user.userId,
    action: 'GATEWAY_CREATE',
    targetType: 'Gateway',
    targetId: result.id,
    details: { name: data.name, type: data.type, isDefault: data.isDefault ?? false },
    ipAddress: getClientIp(req),
  });

  // Note: for MANAGED_SSH gateways the SSH key is baked into instances
  // at deploy time via SSH_AUTHORIZED_KEYS env var. No push needed here.
  res.status(201).json(result);
}

export async function update(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const data = req.body as UpdateGatewayInput;
  const gatewayId = req.params.id as string;
  const result = await gatewayService.updateGateway(
    req.user.userId,
    req.user.tenantId,
    gatewayId,
    data,
  );
  auditService.log({
    userId: req.user.userId,
    action: 'GATEWAY_UPDATE',
    targetType: 'Gateway',
    targetId: gatewayId,
    details: { fields: Object.keys(data) },
    ipAddress: getClientIp(req),
  });
  res.json(result);
}

export async function remove(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const gatewayId = req.params.id as string;
  const force = req.query.force === 'true';
  const result = await gatewayService.deleteGateway(req.user.tenantId, gatewayId, force);

  if ('blocked' in result && result.blocked) {
    res.status(409).json({
      error: `Cannot delete gateway: ${result.connectionCount} connection(s) are using it.`,
      connectionCount: result.connectionCount,
    });
    return;
  }

  auditService.log({
    userId: req.user.userId,
    action: 'GATEWAY_DELETE',
    targetType: 'Gateway',
    targetId: gatewayId,
    details: result.connectionCount > 0
      ? { force: true, disconnectedConnections: result.connectionCount }
      : undefined,
    ipAddress: getClientIp(req),
  });
  res.json({ deleted: true });
}

export async function testConnectivity(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const gatewayId = req.params.id as string;
  const result = await gatewayService.testGatewayConnectivity(
    req.user.tenantId,
    gatewayId,
  );
  res.json(result);
}

export async function generateSshKeyPair(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const result = await sshKeyService.generateKeyPair(req.user.tenantId);
  auditService.log({
    userId: req.user.userId,
    action: 'SSH_KEY_GENERATE',
    targetType: 'SshKeyPair',
    targetId: result.id,
    ipAddress: getClientIp(req),
  });
  res.status(201).json(result);
}

export async function getSshPublicKey(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const result = await sshKeyService.getPublicKey(req.user.tenantId);
  if (!result) {
    throw new AppError('No SSH key pair found for this tenant', 404);
  }
  res.json(result);
}

export async function rotateSshKeyPair(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const result = await sshKeyService.rotateKeyPair(req.user.tenantId);
  auditService.log({
    userId: req.user.userId,
    action: 'SSH_KEY_ROTATE',
    targetType: 'SshKeyPair',
    targetId: result.id,
    ipAddress: getClientIp(req),
  });

  // Best-effort auto-push rotated key to all managed gateways
  const pushResults = await gatewayService.pushKeyToAllManagedGateways(req.user.tenantId);
  for (const pr of pushResults) {
    if (pr.ok) {
      auditService.log({
        userId: req.user.userId,
        action: 'SSH_KEY_PUSH',
        targetType: 'Gateway',
        targetId: pr.gatewayId,
        details: { auto: true, trigger: 'rotate' },
        ipAddress: getClientIp(req),
      });
    }
  }

  res.json({ ...result, pushResults });
}

export async function pushKey(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const gatewayId = req.params.id as string;
  const results = await gatewayService.pushKeyToGateway(
    req.user.tenantId,
    gatewayId,
  );
  const succeeded = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  auditService.log({
    userId: req.user.userId,
    action: 'SSH_KEY_PUSH',
    targetType: 'Gateway',
    targetId: gatewayId,
    ipAddress: getClientIp(req),
    details: { instances: results.length, succeeded, failed },
  });
  res.json({ ok: failed === 0, instances: results });
}

export async function downloadSshPrivateKey(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const privateKeyBuf = await sshKeyService.getPrivateKey(req.user.tenantId);
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'attachment; filename="tenant_ed25519"');
  res.send(privateKeyBuf.toString('utf8'));
}

export async function updateRotationPolicy(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const data = req.body as RotationPolicyInput;

  const input: sshKeyService.RotationPolicyInput = {};
  if (data.autoRotateEnabled !== undefined) {
    input.autoRotateEnabled = data.autoRotateEnabled;
  }
  if (data.rotationIntervalDays !== undefined) {
    input.rotationIntervalDays = data.rotationIntervalDays;
  }
  if (data.expiresAt !== undefined) {
    input.expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
  }

  const result = await sshKeyService.updateRotationPolicy(req.user.tenantId, input);

  auditService.log({
    userId: req.user.userId,
    action: 'SSH_KEY_ROTATE',
    targetType: 'SshKeyPair',
    targetId: result.id,
    details: { policyUpdate: data },
    ipAddress: getClientIp(req),
  });

  res.json(result);
}

export async function getRotationStatus(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const result = await sshKeyService.getRotationStatus(req.user.tenantId);
  res.json(result);
}

// ---------------------------------------------------------------------------
// Managed gateway lifecycle endpoints
// ---------------------------------------------------------------------------

export async function deploy(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const gatewayId = req.params.id as string;

  // Verify gateway belongs to tenant
  const gateway = await prisma.gateway.findFirst({
    where: { id: gatewayId, tenantId: req.user.tenantId },
  });
  if (!gateway) throw new AppError('Gateway not found', 404);

  if (gateway.type !== 'MANAGED_SSH' && gateway.type !== 'GUACD') {
    throw new AppError('Only MANAGED_SSH and GUACD gateways can be deployed as managed containers', 400);
  }

  const result = await managedGatewayService.deployGatewayInstance(gatewayId, req.user.userId);

  // Update managed state
  const instanceCount = await prisma.managedGatewayInstance.count({
    where: { gatewayId, status: { notIn: ['ERROR', 'REMOVING'] } },
  });
  await prisma.gateway.update({
    where: { id: gatewayId },
    data: { isManaged: true, desiredReplicas: instanceCount },
  });

  res.status(201).json(result);
}

export async function undeploy(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const gatewayId = req.params.id as string;

  // Verify gateway belongs to tenant
  const gateway = await prisma.gateway.findFirst({
    where: { id: gatewayId, tenantId: req.user.tenantId },
  });
  if (!gateway) throw new AppError('Gateway not found', 404);

  await managedGatewayService.scaleGateway(gatewayId, 0, req.user.userId);
  res.json({ undeployed: true });
}

export async function scale(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const gatewayId = req.params.id as string;

  // Verify gateway belongs to tenant
  const gateway = await prisma.gateway.findFirst({
    where: { id: gatewayId, tenantId: req.user.tenantId },
  });
  if (!gateway) throw new AppError('Gateway not found', 404);

  const { replicas } = req.body as ScaleInput;
  const result = await managedGatewayService.scaleGateway(gatewayId, replicas, req.user.userId);
  res.json(result);
}

export async function listInstances(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const gatewayId = req.params.id as string;

  // Verify gateway belongs to tenant
  const gateway = await prisma.gateway.findFirst({
    where: { id: gatewayId, tenantId: req.user.tenantId },
  });
  if (!gateway) throw new AppError('Gateway not found', 404);

  const instances = await prisma.managedGatewayInstance.findMany({
    where: { gatewayId },
    orderBy: { createdAt: 'asc' },
  });
  res.json(instances);
}

export async function restartInstance(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const gatewayId = req.params.id as string;
  const instanceId = req.params.instanceId as string;

  // Verify gateway belongs to tenant
  const gateway = await prisma.gateway.findFirst({
    where: { id: gatewayId, tenantId: req.user.tenantId },
  });
  if (!gateway) throw new AppError('Gateway not found', 404);

  const instance = await prisma.managedGatewayInstance.findFirst({
    where: { id: instanceId, gatewayId },
  });
  if (!instance) throw new AppError('Instance not found', 404);

  const orchestrator = getOrchestrator();
  await orchestrator.restartContainer(instance.containerId);

  await prisma.managedGatewayInstance.update({
    where: { id: instanceId },
    data: { consecutiveFailures: 0, errorMessage: null },
  });

  auditService.log({
    userId: req.user.userId,
    action: 'GATEWAY_RESTART' as const,
    targetType: 'ManagedGatewayInstance',
    targetId: instanceId,
    details: { gatewayId, containerId: instance.containerId },
    ipAddress: getClientIp(req),
  });

  // Push real-time instance status update
  emitInstancesForGateway(gatewayId).catch(() => {});

  res.json({ restarted: true });
}

export async function getInstanceLogs(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const gatewayId = req.params.id as string;
  const instanceId = req.params.instanceId as string;
  const tail = Math.max(1, Math.min(parseInt(req.query.tail as string, 10) || 200, 5000));

  const gateway = await prisma.gateway.findFirst({
    where: { id: gatewayId, tenantId: req.user.tenantId },
  });
  if (!gateway) throw new AppError('Gateway not found', 404);

  const instance = await prisma.managedGatewayInstance.findFirst({
    where: { id: instanceId, gatewayId },
  });
  if (!instance) throw new AppError('Instance not found', 404);

  const orchestrator = getOrchestrator();
  const logs = await orchestrator.getContainerLogs(instance.containerId, tail);

  auditService.log({
    userId: req.user.userId,
    action: 'GATEWAY_VIEW_LOGS' as const,
    targetType: 'ManagedGatewayInstance',
    targetId: instanceId,
    details: { gatewayId, containerId: instance.containerId, tail },
    ipAddress: getClientIp(req),
  });

  res.json({
    logs,
    containerId: instance.containerId,
    containerName: instance.containerName,
    timestamp: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Auto-Scaling
// ---------------------------------------------------------------------------

export async function getScalingStatus(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const gatewayId = req.params.id as string;

  const gateway = await prisma.gateway.findFirst({
    where: { id: gatewayId, tenantId: req.user.tenantId },
  });
  if (!gateway) throw new AppError('Gateway not found', 404);

  const status = await autoscalerService.getScalingStatus(gatewayId);
  res.json(status);
}

export async function updateScalingConfig(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const gatewayId = req.params.id as string;

  const gateway = await prisma.gateway.findFirst({
    where: { id: gatewayId, tenantId: req.user.tenantId },
  });
  if (!gateway) throw new AppError('Gateway not found', 404);

  if (!gateway.isManaged) {
    throw new AppError('Auto-scaling is only available for managed gateways', 400);
  }

  const data = req.body as ScalingConfigInput;

  // Cross-validate against existing values when only one of min/max is provided
  if (data.minReplicas !== undefined && data.maxReplicas === undefined) {
    if (data.minReplicas > gateway.maxReplicas) {
      throw new AppError('minReplicas cannot exceed current maxReplicas', 400);
    }
  }
  if (data.maxReplicas !== undefined && data.minReplicas === undefined) {
    if (data.maxReplicas < gateway.minReplicas) {
      throw new AppError('maxReplicas cannot be less than current minReplicas', 400);
    }
  }

  const updated = await prisma.gateway.update({
    where: { id: gatewayId },
    data: {
      ...(data.autoScale !== undefined && { autoScale: data.autoScale }),
      ...(data.minReplicas !== undefined && { minReplicas: data.minReplicas }),
      ...(data.maxReplicas !== undefined && { maxReplicas: data.maxReplicas }),
      ...(data.sessionsPerInstance !== undefined && { sessionsPerInstance: data.sessionsPerInstance }),
      ...(data.scaleDownCooldownSeconds !== undefined && { scaleDownCooldownSeconds: data.scaleDownCooldownSeconds }),
    },
    select: {
      id: true,
      autoScale: true,
      minReplicas: true,
      maxReplicas: true,
      sessionsPerInstance: true,
      scaleDownCooldownSeconds: true,
      lastScaleAction: true,
    },
  });

  auditService.log({
    userId: req.user.userId,
    action: 'GATEWAY_UPDATE',
    targetType: 'Gateway',
    targetId: gatewayId,
    details: { scalingConfig: data },
    ipAddress: getClientIp(req),
  });

  // Push real-time updates for config change
  emitGatewayData(gatewayId).catch(() => {});
  emitScalingForGateway(gatewayId).catch(() => {});

  res.json(updated);
}

// ---------------------------------------------------------------------------
// Gateway Templates
// ---------------------------------------------------------------------------

export async function listTemplates(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const result = await gatewayTemplateService.listTemplates(req.user.tenantId);
  res.json(result);
}

export async function createTemplate(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const data = req.body as CreateTemplateInput;
  // .refine() guarantees port is always defined (defaults for managed types, required for SSH_BASTION)
  const result = await gatewayTemplateService.createTemplate(
    req.user.userId,
    req.user.tenantId,
    data as CreateTemplateInput & { port: number },
  );
  auditService.log({
    userId: req.user.userId,
    action: 'GATEWAY_TEMPLATE_CREATE',
    targetType: 'GatewayTemplate',
    targetId: result.id,
    details: { name: result.name, type: result.type },
    ipAddress: getClientIp(req),
  });
  res.status(201).json(result);
}

export async function updateTemplate(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const templateId = req.params.templateId as string;
  const data = req.body as UpdateTemplateInput;
  const result = await gatewayTemplateService.updateTemplate(
    req.user.userId,
    req.user.tenantId,
    templateId,
    data,
  );
  auditService.log({
    userId: req.user.userId,
    action: 'GATEWAY_TEMPLATE_UPDATE',
    targetType: 'GatewayTemplate',
    targetId: templateId,
    details: data,
    ipAddress: getClientIp(req),
  });
  res.json(result);
}

export async function deleteTemplate(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const templateId = req.params.templateId as string;
  await gatewayTemplateService.deleteTemplate(req.user.tenantId, templateId);
  auditService.log({
    userId: req.user.userId,
    action: 'GATEWAY_TEMPLATE_DELETE',
    targetType: 'GatewayTemplate',
    targetId: templateId,
    ipAddress: getClientIp(req),
  });
  res.json({ deleted: true });
}

export async function deployFromTemplate(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const templateId = req.params.templateId as string;
  const result = await gatewayTemplateService.deployFromTemplate(
    req.user.userId,
    req.user.tenantId,
    templateId,
  );
  auditService.log({
    userId: req.user.userId,
    action: 'GATEWAY_TEMPLATE_DEPLOY',
    targetType: 'GatewayTemplate',
    targetId: templateId,
    details: { gatewayId: result.id, gatewayName: result.name },
    ipAddress: getClientIp(req),
  });
  res.status(201).json(result);
}

// ---------------------------------------------------------------------------
// Zero-trust tunnel token management
// ---------------------------------------------------------------------------

export async function generateTunnelToken(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const gatewayId = req.params.id as string;
  const result = await gatewayService.generateGatewayTunnelToken(
    req.user.tenantId,
    gatewayId,
    req.user.userId,
  );
  // Audit logging is handled by tunnel.service — no duplicate here
  // Return the plain token only once — the caller must store it
  res.status(201).json({
    token: result.token,
    tunnelEnabled: result.tunnelEnabled,
    tunnelConnected: isTunnelConnected(gatewayId),
  });
}

export async function revokeTunnelToken(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const gatewayId = req.params.id as string;
  await gatewayService.revokeGatewayTunnelToken(
    req.user.tenantId,
    gatewayId,
    req.user.userId,
  );
  // Audit logging is handled by tunnel.service — no duplicate here
  res.json({ revoked: true, tunnelEnabled: false });
}
