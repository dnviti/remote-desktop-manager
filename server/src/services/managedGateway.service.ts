import prisma, { ManagedInstanceStatus } from '../lib/prisma';
import {
  getOrchestrator,
  OrchestratorType,
  ContainerConfig,
  ContainerStatus,
} from '../orchestrator';
import { config } from '../config';
import { AppError } from '../middleware/error.middleware';
import * as auditService from './audit.service';
import { logger } from '../utils/logger';

const MAX_REPLICAS = 20;
const HEALTH_CHECK_FAILURE_THRESHOLD = 3;
const LOG_PREFIX = '[managed-gateway]';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireOrchestrator() {
  const orch = getOrchestrator();
  if (orch.type === OrchestratorType.NONE) {
    throw new AppError(
      'Container orchestration is not available. Configure Docker, Podman, or Kubernetes.',
      501,
    );
  }
  return orch;
}

function buildContainerConfig(
  gateway: { id: string; name: string; type: string; port: number; tenantId: string },
  instanceIndex: number,
  publicKey?: string,
): ContainerConfig {
  const suffix = `${gateway.id.slice(0, 8)}-${instanceIndex}`;
  const tenantSlug = gateway.tenantId.slice(0, 8);
  const slug = gateway.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
  const baseName = `rdm-gw-${tenantSlug}-${slug}-${suffix}`;
  const k8sNamespace = `rdm-${gateway.tenantId}`;

  if (gateway.type === 'MANAGED_SSH') {
    return {
      image: config.orchestratorSshGatewayImage,
      name: baseName,
      namespace: k8sNamespace,
      env: {
        ...(publicKey ? { SSH_AUTHORIZED_KEYS: publicKey } : {}),
      },
      ports: [{ container: 2222 }],
      labels: {
        'rdm.managed': 'true',
        'rdm.gateway-id': gateway.id,
        'rdm.tenant-id': gateway.tenantId,
        'rdm.type': 'ssh',
      },
      ...(config.dockerNetwork ? { network: config.dockerNetwork } : {}),
      restartPolicy: 'unless-stopped',
    };
  }

  // GUACD
  return {
    image: config.orchestratorGuacdImage,
    name: baseName,
    namespace: k8sNamespace,
    env: {},
    ports: [{ container: 4822 }],
    labels: {
      'rdm.managed': 'true',
      'rdm.gateway-id': gateway.id,
      'rdm.tenant-id': gateway.tenantId,
      'rdm.type': 'guacd',
    },
    ...(config.dockerNetwork ? { network: config.dockerNetwork } : {}),
    restartPolicy: 'unless-stopped',
  };
}

// ---------------------------------------------------------------------------
// Deploy / Remove
// ---------------------------------------------------------------------------

export async function deployGatewayInstance(
  gatewayId: string,
  userId?: string,
): Promise<{ instanceId: string; containerId: string; host: string; port: number }> {
  const orchestrator = requireOrchestrator();

  const gateway = await prisma.gateway.findUnique({
    where: { id: gatewayId },
    include: { tenant: { include: { sshKeyPair: true } } },
  });
  if (!gateway) throw new AppError('Gateway not found', 404);

  if (gateway.type !== 'MANAGED_SSH' && gateway.type !== 'GUACD') {
    throw new AppError(
      'Only MANAGED_SSH and GUACD gateways can be deployed as managed containers',
      400,
    );
  }

  let publicKey: string | undefined;
  if (gateway.type === 'MANAGED_SSH') {
    if (!gateway.tenant.sshKeyPair) {
      throw new AppError(
        'SSH key pair not found for this tenant. Generate one first.',
        400,
      );
    }
    publicKey = gateway.tenant.sshKeyPair.publicKey;
  }

  const existingCount = await prisma.managedGatewayInstance.count({
    where: { gatewayId },
  });

  const containerConfig = buildContainerConfig(gateway, existingCount, publicKey);

  let containerInfo;
  try {
    containerInfo = await orchestrator.deployContainer(containerConfig);
  } catch (err) {
    // Record failed deployment
    await prisma.managedGatewayInstance.create({
      data: {
        gatewayId,
        containerId: `failed-${Date.now()}`,
        containerName: containerConfig.name,
        host: 'unknown',
        port: 0,
        status: ManagedInstanceStatus.ERROR,
        orchestratorType: orchestrator.type,
        errorMessage: (err as Error).message,
      },
    });
    logger.error(`${LOG_PREFIX} Failed to deploy container for gateway ${gatewayId}: ${(err as Error).message}`);
    throw new AppError(`Container deployment failed: ${(err as Error).message}`, 500);
  }

  // Determine host and port from container info.
  // K8s: service name is the container name (DNS-resolvable within the cluster).
  // Docker with custom network: container name is DNS-resolvable.
  // Docker with port mapping: use localhost.
  let host: string;
  if (orchestrator.type === OrchestratorType.KUBERNETES) {
    host = containerConfig.name;
  } else if (containerInfo.ports[0]?.host) {
    host = 'localhost';
  } else if (config.dockerNetwork) {
    host = containerConfig.name;
  } else {
    host = 'localhost';
  }
  const port = containerInfo.ports[0]?.host ?? containerInfo.ports[0]?.container ?? gateway.port;

  const instance = await prisma.managedGatewayInstance.create({
    data: {
      gatewayId,
      containerId: containerInfo.id,
      containerName: containerInfo.name,
      host,
      port,
      status: ManagedInstanceStatus.RUNNING,
      orchestratorType: orchestrator.type,
      healthStatus: 'healthy',
      lastHealthCheck: new Date(),
    },
  });

  if (userId) {
    auditService.log({
      userId,
      action: 'GATEWAY_DEPLOY',
      targetType: 'Gateway',
      targetId: gatewayId,
      details: {
        instanceId: instance.id,
        containerId: containerInfo.id,
        containerName: containerInfo.name,
        orchestratorType: orchestrator.type,
      },
    });
  }

  logger.info(`${LOG_PREFIX} Deployed instance ${instance.id} (container ${containerInfo.id}) for gateway ${gatewayId}`);

  return {
    instanceId: instance.id,
    containerId: containerInfo.id,
    host,
    port,
  };
}

export async function removeGatewayInstance(
  instanceId: string,
  userId?: string,
): Promise<void> {
  const orchestrator = requireOrchestrator();

  const instance = await prisma.managedGatewayInstance.findUnique({
    where: { id: instanceId },
  });
  if (!instance) throw new AppError('Instance not found', 404);

  await prisma.managedGatewayInstance.update({
    where: { id: instanceId },
    data: { status: ManagedInstanceStatus.REMOVING },
  });

  try {
    await orchestrator.removeContainer(instance.containerId);
  } catch (err) {
    // Container may already be gone — log and proceed with DB cleanup
    logger.warn(`${LOG_PREFIX} Failed to remove container ${instance.containerId}: ${(err as Error).message}`);
  }

  await prisma.managedGatewayInstance.delete({ where: { id: instanceId } });

  if (userId) {
    auditService.log({
      userId,
      action: 'GATEWAY_UNDEPLOY',
      targetType: 'ManagedGatewayInstance',
      targetId: instanceId,
      details: {
        gatewayId: instance.gatewayId,
        containerId: instance.containerId,
      },
    });
  }

  logger.info(`${LOG_PREFIX} Removed instance ${instanceId} (container ${instance.containerId})`);
}

// ---------------------------------------------------------------------------
// Scale
// ---------------------------------------------------------------------------

export async function scaleGateway(
  gatewayId: string,
  replicas: number,
  userId?: string,
): Promise<{ deployed: number; removed: number }> {
  if (replicas < 0 || replicas > MAX_REPLICAS) {
    throw new AppError(`Replicas must be between 0 and ${MAX_REPLICAS}`, 400);
  }

  const gateway = await prisma.gateway.findUnique({ where: { id: gatewayId } });
  if (!gateway) throw new AppError('Gateway not found', 404);

  if (gateway.type !== 'MANAGED_SSH' && gateway.type !== 'GUACD') {
    throw new AppError(
      'Only MANAGED_SSH and GUACD gateways can be scaled',
      400,
    );
  }

  const currentInstances = await prisma.managedGatewayInstance.findMany({
    where: {
      gatewayId,
      status: { notIn: [ManagedInstanceStatus.ERROR, ManagedInstanceStatus.REMOVING] },
    },
    orderBy: { createdAt: 'asc' },
  });

  const currentCount = currentInstances.length;
  let deployed = 0;
  let removed = 0;

  if (replicas > currentCount) {
    // Scale up
    const toCreate = replicas - currentCount;
    for (let i = 0; i < toCreate; i++) {
      try {
        await deployGatewayInstance(gatewayId, userId);
        deployed++;
      } catch (err) {
        logger.error(`${LOG_PREFIX} Scale-up deploy ${i + 1}/${toCreate} failed: ${(err as Error).message}`);
      }
    }
  } else if (replicas < currentCount) {
    // Scale down — remove newest instances first (most recently created)
    const toRemove = currentCount - replicas;
    const sortedInstances = [...currentInstances].reverse();

    for (let i = 0; i < toRemove && i < sortedInstances.length; i++) {
      try {
        await removeGatewayInstance(sortedInstances[i].id, userId);
        removed++;
      } catch (err) {
        logger.error(`${LOG_PREFIX} Scale-down remove failed: ${(err as Error).message}`);
      }
    }
  }

  // Update gateway managed state
  await prisma.gateway.update({
    where: { id: gatewayId },
    data: {
      desiredReplicas: replicas,
      isManaged: replicas > 0,
    },
  });

  if (userId) {
    auditService.log({
      userId,
      action: 'GATEWAY_SCALE',
      targetType: 'Gateway',
      targetId: gatewayId,
      details: { from: currentCount, to: replicas, deployed, removed },
    });
  }

  logger.info(`${LOG_PREFIX} Scaled gateway ${gatewayId}: ${currentCount} → ${replicas} (deployed: ${deployed}, removed: ${removed})`);

  return { deployed, removed };
}

// ---------------------------------------------------------------------------
// Reconcile
// ---------------------------------------------------------------------------

export async function reconcileGateway(gatewayId: string): Promise<void> {
  const gateway = await prisma.gateway.findUnique({
    where: { id: gatewayId },
  });
  if (!gateway || !gateway.isManaged) return;

  const orchestrator = getOrchestrator();
  if (orchestrator.type === OrchestratorType.NONE) return;

  const instances = await prisma.managedGatewayInstance.findMany({
    where: { gatewayId },
  });

  // Remove ERROR instances
  const errorInstances = instances.filter(i => i.status === ManagedInstanceStatus.ERROR);
  for (const instance of errorInstances) {
    try {
      await prisma.managedGatewayInstance.delete({ where: { id: instance.id } });
      // Try to clean up the container if it exists
      if (!instance.containerId.startsWith('failed-')) {
        await orchestrator.removeContainer(instance.containerId).catch(() => {});
      }
    } catch {
      // Ignore cleanup failures
    }
  }

  // Restart STOPPED instances
  const stoppedInstances = instances.filter(i => i.status === ManagedInstanceStatus.STOPPED);
  for (const instance of stoppedInstances) {
    try {
      await orchestrator.restartContainer(instance.containerId);
      await prisma.managedGatewayInstance.update({
        where: { id: instance.id },
        data: { status: ManagedInstanceStatus.RUNNING, errorMessage: null, consecutiveFailures: 0 },
      });
      logger.info(`${LOG_PREFIX} Reconcile: restarted stopped instance ${instance.id}`);
    } catch (err) {
      logger.warn(`${LOG_PREFIX} Reconcile: failed to restart instance ${instance.id}: ${(err as Error).message}`);
      await prisma.managedGatewayInstance.update({
        where: { id: instance.id },
        data: { status: ManagedInstanceStatus.ERROR, errorMessage: (err as Error).message },
      });
    }
  }

  // Count healthy instances
  const healthyInstances = await prisma.managedGatewayInstance.count({
    where: {
      gatewayId,
      status: { in: [ManagedInstanceStatus.RUNNING, ManagedInstanceStatus.PROVISIONING] },
    },
  });

  // Scale up if needed
  if (healthyInstances < gateway.desiredReplicas) {
    const toCreate = gateway.desiredReplicas - healthyInstances;
    for (let i = 0; i < toCreate; i++) {
      try {
        await deployGatewayInstance(gatewayId);
        logger.info(`${LOG_PREFIX} Reconcile: deployed replacement instance for gateway ${gatewayId}`);
      } catch (err) {
        logger.error(`${LOG_PREFIX} Reconcile: failed to deploy replacement: ${(err as Error).message}`);
      }
    }
  }

  // Scale down if needed (excess healthy instances)
  if (healthyInstances > gateway.desiredReplicas) {
    const runningInstances = await prisma.managedGatewayInstance.findMany({
      where: {
        gatewayId,
        status: { in: [ManagedInstanceStatus.RUNNING, ManagedInstanceStatus.PROVISIONING] },
      },
      orderBy: { createdAt: 'desc' }, // Remove newest first
    });

    const toRemove = healthyInstances - gateway.desiredReplicas;
    for (let i = 0; i < toRemove && i < runningInstances.length; i++) {
      try {
        await removeGatewayInstance(runningInstances[i].id);
      } catch (err) {
        logger.warn(`${LOG_PREFIX} Reconcile: failed to remove excess instance: ${(err as Error).message}`);
      }
    }
  }
}

export async function reconcileAll(): Promise<void> {
  const managedGateways = await prisma.gateway.findMany({
    where: { isManaged: true },
    select: { id: true },
  });

  if (managedGateways.length === 0) return;

  let reconciled = 0;
  let failed = 0;

  for (const gw of managedGateways) {
    try {
      await reconcileGateway(gw.id);
      reconciled++;
    } catch (err) {
      failed++;
      logger.error(`${LOG_PREFIX} Reconcile failed for gateway ${gw.id}: ${(err as Error).message}`);
    }
  }

  if (reconciled > 0 || failed > 0) {
    logger.info(`${LOG_PREFIX} Reconciliation complete: ${reconciled} ok, ${failed} failed`);
  }
}

// ---------------------------------------------------------------------------
// Health Check
// ---------------------------------------------------------------------------

export async function healthCheck(): Promise<void> {
  const orchestrator = getOrchestrator();
  if (orchestrator.type === OrchestratorType.NONE) return;

  const instances = await prisma.managedGatewayInstance.findMany({
    where: {
      status: { in: [ManagedInstanceStatus.RUNNING, ManagedInstanceStatus.PROVISIONING] },
    },
  });

  if (instances.length === 0) return;

  let healthy = 0;
  let unhealthy = 0;
  let restarted = 0;

  for (const instance of instances) {
    try {
      const info = await orchestrator.getContainerStatus(instance.containerId);
      const isHealthy = info.status === ContainerStatus.RUNNING;

      if (isHealthy) {
        healthy++;
        await prisma.managedGatewayInstance.update({
          where: { id: instance.id },
          data: {
            healthStatus: info.health ?? 'healthy',
            lastHealthCheck: new Date(),
            consecutiveFailures: 0,
            status: ManagedInstanceStatus.RUNNING,
            errorMessage: null,
          },
        });
      } else {
        unhealthy++;
        const newFailures = instance.consecutiveFailures + 1;

        if (newFailures >= HEALTH_CHECK_FAILURE_THRESHOLD) {
          // Attempt restart
          try {
            await orchestrator.restartContainer(instance.containerId);
            restarted++;
            await prisma.managedGatewayInstance.update({
              where: { id: instance.id },
              data: {
                healthStatus: 'restarting',
                lastHealthCheck: new Date(),
                consecutiveFailures: 0,
                errorMessage: null,
              },
            });
            logger.warn(`${LOG_PREFIX} Restarted unhealthy instance ${instance.id} after ${HEALTH_CHECK_FAILURE_THRESHOLD} failures`);
          } catch (restartErr) {
            await prisma.managedGatewayInstance.update({
              where: { id: instance.id },
              data: {
                status: ManagedInstanceStatus.ERROR,
                healthStatus: 'unhealthy',
                lastHealthCheck: new Date(),
                consecutiveFailures: newFailures,
                errorMessage: `Restart failed: ${(restartErr as Error).message}`,
              },
            });
          }
        } else {
          await prisma.managedGatewayInstance.update({
            where: { id: instance.id },
            data: {
              healthStatus: info.health ?? 'unhealthy',
              lastHealthCheck: new Date(),
              consecutiveFailures: newFailures,
            },
          });
        }
      }
    } catch (err) {
      // Container is gone or unreachable
      unhealthy++;
      await prisma.managedGatewayInstance.update({
        where: { id: instance.id },
        data: {
          status: ManagedInstanceStatus.ERROR,
          healthStatus: 'unhealthy',
          lastHealthCheck: new Date(),
          consecutiveFailures: instance.consecutiveFailures + 1,
          errorMessage: `Container unreachable: ${(err as Error).message}`,
        },
      });
    }
  }

  if (unhealthy > 0 || restarted > 0) {
    logger.info(`${LOG_PREFIX} Health check: ${healthy} healthy, ${unhealthy} unhealthy, ${restarted} restarted`);
  }
}

// ---------------------------------------------------------------------------
// SSH Key Push
// ---------------------------------------------------------------------------

export async function pushSshKeyToInstances(
  tenantId: string,
  publicKey: string,
): Promise<{ instanceId: string; ok: boolean; error?: string }[]> {
  const orchestrator = getOrchestrator();
  if (orchestrator.type === OrchestratorType.NONE) return [];

  const instances = await prisma.managedGatewayInstance.findMany({
    where: {
      status: ManagedInstanceStatus.RUNNING,
      gateway: {
        tenantId,
        type: 'MANAGED_SSH',
      },
    },
  });

  if (instances.length === 0) return [];

  const results: { instanceId: string; ok: boolean; error?: string }[] = [];

  for (const instance of instances) {
    try {
      await orchestrator.updateContainerEnv(instance.containerId, {
        SSH_AUTHORIZED_KEYS: publicKey,
      });
      results.push({ instanceId: instance.id, ok: true });
    } catch (err) {
      results.push({
        instanceId: instance.id,
        ok: false,
        error: (err as Error).message,
      });
    }
  }

  const succeeded = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  logger.info(`${LOG_PREFIX} SSH key push to ${instances.length} instances: ${succeeded} ok, ${failed} failed`);

  return results;
}
