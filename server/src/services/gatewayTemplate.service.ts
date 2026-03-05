import prisma from '../lib/prisma';
import type { GatewayType } from '../lib/prisma';
import { AppError } from '../middleware/error.middleware';
import { deployGatewayInstance } from './managedGateway.service';
import { startMonitor, startInstanceMonitor } from './gatewayMonitor.service';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

const log = logger.child('gateway-template');

export interface CreateTemplateInput {
  name: string;
  type: GatewayType;
  host: string;
  port: number;
  description?: string;
  apiPort?: number;
  autoScale?: boolean;
  minReplicas?: number;
  maxReplicas?: number;
  sessionsPerInstance?: number;
  scaleDownCooldownSeconds?: number;
  monitoringEnabled?: boolean;
  monitorIntervalMs?: number;
  inactivityTimeoutSeconds?: number;
  publishPorts?: boolean;
  lbStrategy?: 'ROUND_ROBIN' | 'LEAST_CONNECTIONS';
}

export interface UpdateTemplateInput {
  name?: string;
  type?: GatewayType;
  host?: string;
  port?: number;
  description?: string | null;
  apiPort?: number | null;
  autoScale?: boolean;
  minReplicas?: number;
  maxReplicas?: number;
  sessionsPerInstance?: number;
  scaleDownCooldownSeconds?: number;
  monitoringEnabled?: boolean;
  monitorIntervalMs?: number;
  inactivityTimeoutSeconds?: number;
  publishPorts?: boolean;
  lbStrategy?: 'ROUND_ROBIN' | 'LEAST_CONNECTIONS';
}

export async function listTemplates(tenantId: string) {
  const templates = await prisma.gatewayTemplate.findMany({
    where: { tenantId },
    orderBy: { name: 'asc' },
    include: { _count: { select: { gateways: true } } },
  });
  log.debug(`Listed ${templates.length} templates for tenant ${tenantId}`);
  return templates;
}

export async function createTemplate(
  userId: string,
  tenantId: string,
  input: CreateTemplateInput,
) {
  log.info(`Creating template "${input.name}" (${input.type}) in tenant ${tenantId}`);
  return prisma.gatewayTemplate.create({
    data: {
      name: input.name,
      type: input.type,
      host: input.host,
      port: input.port,
      description: input.description,
      apiPort: input.apiPort,
      autoScale: input.autoScale,
      minReplicas: input.minReplicas,
      maxReplicas: input.maxReplicas,
      sessionsPerInstance: input.sessionsPerInstance,
      scaleDownCooldownSeconds: input.scaleDownCooldownSeconds,
      monitoringEnabled: input.monitoringEnabled,
      monitorIntervalMs: input.monitorIntervalMs,
      inactivityTimeoutSeconds: input.inactivityTimeoutSeconds,
      publishPorts: input.publishPorts,
      lbStrategy: input.lbStrategy,
      tenantId,
      createdById: userId,
    },
    include: { _count: { select: { gateways: true } } },
  });
}

export async function updateTemplate(
  _userId: string,
  tenantId: string,
  templateId: string,
  input: UpdateTemplateInput,
) {
  const existing = await prisma.gatewayTemplate.findFirst({
    where: { id: templateId, tenantId },
  });
  if (!existing) throw new AppError('Gateway template not found', 404);

  log.info(`Updating template ${templateId} "${existing.name}" in tenant ${tenantId}`);
  return prisma.gatewayTemplate.update({
    where: { id: templateId },
    data: input,
    include: { _count: { select: { gateways: true } } },
  });
}

export async function deleteTemplate(tenantId: string, templateId: string) {
  const existing = await prisma.gatewayTemplate.findFirst({
    where: { id: templateId, tenantId },
  });
  if (!existing) throw new AppError('Gateway template not found', 404);

  await prisma.gatewayTemplate.delete({ where: { id: templateId } });
  log.info(`Deleted template ${templateId} "${existing.name}" in tenant ${tenantId}`);
  return { deleted: true };
}

export async function deployFromTemplate(
  userId: string,
  tenantId: string,
  templateId: string,
) {
  const template = await prisma.gatewayTemplate.findFirst({
    where: { id: templateId, tenantId },
  });
  if (!template) throw new AppError('Gateway template not found', 404);

  if (template.type === 'MANAGED_SSH') {
    const keyPair = await prisma.sshKeyPair.findUnique({
      where: { tenantId },
    });
    if (!keyPair) {
      throw new AppError(
        'SSH key pair not found for this tenant. Generate one first.',
        400,
      );
    }
  }

  const tenantPrefix = tenantId.slice(0, 8);
  const autoName = `${tenantPrefix}-${template.name}-${uuidv4().slice(0, 6)}`;

  // If the template host is blank, use a placeholder; it will be updated
  // after the first container is deployed with the actual container name.
  const initialHost = template.host || 'pending-deploy';

  let gateway = await prisma.gateway.create({
    data: {
      name: autoName,
      type: template.type,
      host: initialHost,
      port: template.port,
      description: template.description,
      apiPort: template.apiPort,
      isManaged: true,
      desiredReplicas: 1,
      autoScale: template.autoScale,
      minReplicas: template.minReplicas,
      maxReplicas: template.maxReplicas,
      sessionsPerInstance: template.sessionsPerInstance,
      scaleDownCooldownSeconds: template.scaleDownCooldownSeconds,
      monitoringEnabled: template.monitoringEnabled,
      monitorIntervalMs: template.monitorIntervalMs,
      inactivityTimeoutSeconds: template.inactivityTimeoutSeconds,
      publishPorts: template.publishPorts,
      lbStrategy: template.lbStrategy,
      tenantId,
      createdById: userId,
      templateId,
    },
  });

  log.info(`Created gateway "${autoName}" from template "${template.name}"`);

  let deployResult;
  try {
    deployResult = await deployGatewayInstance(gateway.id, userId);
  } catch (err) {
    log.warn(
      `Gateway created but initial deploy failed: ${(err as Error).message}`,
    );
  }

  // If host was blank on the template, update the gateway with the resolved
  // host/port from the deployed container (container name = DNS-resolvable).
  if (!template.host && deployResult) {
    gateway = await prisma.gateway.update({
      where: { id: gateway.id },
      data: { host: deployResult.host, port: deployResult.port },
    });
    log.info(
      `Auto-resolved gateway host to "${deployResult.host}:${deployResult.port}"`,
    );
  }

  if (gateway.monitoringEnabled && gateway.host !== 'pending-deploy') {
    const isManagedPublished = gateway.publishPorts && (gateway.type === 'MANAGED_SSH' || gateway.type === 'GUACD');
    if (isManagedPublished) {
      startInstanceMonitor(gateway.id, tenantId, gateway.monitorIntervalMs);
    } else {
      startMonitor(gateway.id, gateway.host, gateway.port, tenantId, gateway.monitorIntervalMs);
    }
  }

  return {
    ...gateway,
    deployResult: deployResult ?? null,
  };
}
