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
import { findFreePort } from '../utils/freePort';
import { decryptWithServerKey } from './crypto.service';
import { pushKey as grpcPushKey, closeGatewayKeyClient } from '../utils/gatewayKeyClient';
import {
  emitInstancesForGateway,
  emitScalingForGateway,
  emitGatewayData,
} from './gatewayMonitor.service';

const MAX_REPLICAS = 20;
const HEALTH_CHECK_FAILURE_THRESHOLD = 3;
const log = logger.child('managed-gateway');

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

interface TunnelEnvOptions {
  serverUrl: string;
  token: string;
  gatewayId: string;
  caCert?: string;
  clientCert?: string;
  clientKey?: string;
}

function buildContainerConfig(
  gateway: { id: string; name: string; type: string; port: number; tenantId: string },
  instanceIndex: number,
  publicKey?: string,
  hostPort?: number,
  apiHostPort?: number,
  tunnelEnv?: TunnelEnvOptions,
): ContainerConfig {
  const suffix = `${gateway.id.slice(0, 8)}-${instanceIndex}`;
  const tenantSlug = gateway.tenantId.slice(0, 8);
  const slug = gateway.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
  const baseName = `arsenale-gw-${tenantSlug}-${slug}-${suffix}`;
  const k8sNamespace = `arsenale-${gateway.tenantId}`;

  // When tunnel is enabled, suppress host-port publishing (traffic flows via tunnel)
  const publishHostPort = tunnelEnv ? undefined : hostPort;
  const publishApiHostPort = tunnelEnv ? undefined : apiHostPort;

  /** Build tunnel environment variable block (injected into both SSH and GUACD containers). */
  const tunnelEnvVars: Record<string, string> = tunnelEnv
    ? {
        TUNNEL_SERVER_URL:  tunnelEnv.serverUrl,
        TUNNEL_TOKEN:       tunnelEnv.token,
        TUNNEL_GATEWAY_ID:  tunnelEnv.gatewayId,
        TUNNEL_LOCAL_PORT:  gateway.type === 'MANAGED_SSH' ? '2222' : gateway.type === 'DB_PROXY' ? '5432' : '4822',
        ...(tunnelEnv.caCert      ? { TUNNEL_CA_CERT:     tunnelEnv.caCert }      : {}),
        ...(tunnelEnv.clientCert  ? { TUNNEL_CLIENT_CERT: tunnelEnv.clientCert }  : {}),
        ...(tunnelEnv.clientKey   ? { TUNNEL_CLIENT_KEY:  tunnelEnv.clientKey }   : {}),
      }
    : {};

  if (gateway.type === 'MANAGED_SSH') {
    return {
      image: config.orchestratorSshGatewayImage,
      name: baseName,
      namespace: k8sNamespace,
      env: {
        ...(publicKey ? { SSH_AUTHORIZED_KEYS: publicKey } : {}),
        // gRPC key management uses mTLS (certs mounted via volumes), no token needed
        GATEWAY_GRPC_INSECURE: 'true',
        ...tunnelEnvVars,
      },
      ports: [
        { container: 2222, ...(publishHostPort != null ? { host: publishHostPort } : {}) },
      ],
      labels: {
        'arsenale.managed': 'true',
        'arsenale.gateway-id': gateway.id,
        'arsenale.tenant-id': gateway.tenantId,
        'arsenale.type': 'ssh',
      },
      ...(config.dockerNetwork ? { network: config.dockerNetwork } : {}),
      restartPolicy: 'always',
    };
  }

  if (gateway.type === 'DB_PROXY') {
    return {
      image: config.orchestratorDbProxyImage,
      name: baseName,
      namespace: k8sNamespace,
      env: {
        ...tunnelEnvVars,
      },
      ports: [
        { container: 5432, ...(publishHostPort != null ? { host: publishHostPort } : {}) },
      ],
      labels: {
        'arsenale.managed': 'true',
        'arsenale.gateway-id': gateway.id,
        'arsenale.tenant-id': gateway.tenantId,
        'arsenale.type': 'db-proxy',
      },
      ...(config.dockerNetwork ? { network: config.dockerNetwork } : {}),
      restartPolicy: 'always',
    };
  }

  // GUACD
  return {
    image: config.orchestratorGuacdImage,
    name: baseName,
    namespace: k8sNamespace,
    env: {
      ...tunnelEnvVars,
    },
    ports: [{ container: 4822, ...(publishHostPort != null ? { host: publishHostPort } : {}) }],
    labels: {
      'arsenale.managed': 'true',
      'arsenale.gateway-id': gateway.id,
      'arsenale.tenant-id': gateway.tenantId,
      'arsenale.type': 'guacd',
    },
    // Disable Docker-level health check — rootless Podman with user '0:0'
    // blocks exec inside the container (OCI permission denied). The app-level
    // healthCheck() in this file monitors container status instead.
    healthcheck: {
      test: ['NONE'],
      interval: 0,
      timeout: 0,
      retries: 0,
    },
    ...(config.dockerNetwork ? { network: config.dockerNetwork } : {}),
    ...(config.recordingEnabled ? {
      binds: [`${config.recordingVolume || config.recordingPath}:/recordings`],
      user: '0:0',
    } : {}),
    restartPolicy: 'always',
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

  if (gateway.type !== 'MANAGED_SSH' && gateway.type !== 'GUACD' && gateway.type !== 'DB_PROXY') {
    throw new AppError(
      'Only MANAGED_SSH, GUACD, and DB_PROXY gateways can be deployed as managed containers',
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

  log.info(`Deploying instance for gateway ${gatewayId} (${gateway.type})`);

  let hostPort: number | undefined;
  let apiHostPort: number | undefined;
  // When tunnel is enabled, ports are NOT published to the host (traffic flows via tunnel)
  if (gateway.publishPorts && !gateway.tunnelEnabled) {
    hostPort = await findFreePort();
    if (gateway.type === 'MANAGED_SSH') {
      apiHostPort = await findFreePort();
    }
    log.info(`publishPorts enabled — assigned free host port ${hostPort}${apiHostPort ? `, api port ${apiHostPort}` : ''} for gateway ${gatewayId}`);
  }

  // Build tunnel env options if tunnel is enabled for this gateway
  let tunnelEnvOptions: TunnelEnvOptions | undefined;
  if (gateway.tunnelEnabled && gateway.encryptedTunnelToken && gateway.tunnelTokenIV && gateway.tunnelTokenTag) {
    try {
      const plainToken = decryptWithServerKey({
        ciphertext: gateway.encryptedTunnelToken,
        iv: gateway.tunnelTokenIV,
        tag: gateway.tunnelTokenTag,
      });

      // Build the server tunnel URL from the server's own address
      const tunnelServerUrl = process.env.TUNNEL_SERVER_URL;
      if (!tunnelServerUrl) {
        throw new AppError(
          'TUNNEL_SERVER_URL environment variable is required when tunnel is enabled for a gateway',
          500,
        );
      }

      // Decrypt client key if available
      let clientKey: string | undefined;
      if (gateway.tunnelClientKey && gateway.tunnelClientKeyIV && gateway.tunnelClientKeyTag) {
        try {
          clientKey = decryptWithServerKey({
            ciphertext: gateway.tunnelClientKey,
            iv: gateway.tunnelClientKeyIV,
            tag: gateway.tunnelClientKeyTag,
          });
        } catch (keyErr) {
          log.warn(`Failed to decrypt client key for gateway ${gatewayId}: ${(keyErr as Error).message}`);
        }
      }

      tunnelEnvOptions = {
        serverUrl: tunnelServerUrl,
        token: plainToken,
        gatewayId: gateway.id,
        ...(gateway.tunnelCaCert ? { caCert: gateway.tunnelCaCert } : {}),
        ...(gateway.tunnelClientCert ? { clientCert: gateway.tunnelClientCert } : {}),
        ...(clientKey ? { clientKey } : {}),
      };

      log.info(`Tunnel enabled for gateway ${gatewayId} — injecting tunnel env vars, suppressing port mapping`);
    } catch (decryptErr) {
      log.warn(`Failed to decrypt tunnel token for gateway ${gatewayId}: ${(decryptErr as Error).message} — deploying without tunnel`);
    }
  }

  const containerConfig = buildContainerConfig(gateway, existingCount, publicKey, hostPort, apiHostPort, tunnelEnvOptions);
  log.debug(`Container config for gateway ${gatewayId}: image=${containerConfig.image}, name=${containerConfig.name}`);

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
    log.error(`Failed to deploy container for gateway ${gatewayId}: ${(err as Error).message}`);
    throw new AppError(`Container deployment failed: ${(err as Error).message}`, 500);
  }

  // Determine host and port from container info.
  // K8s: service name is the container name (DNS-resolvable within the cluster).
  // Docker with custom network: container name is DNS-resolvable.
  // Docker with port mapping: use localhost.
  let host: string;
  if (orchestrator.type === OrchestratorType.KUBERNETES) {
    host = containerConfig.name;
  } else if (gateway.publishPorts && containerInfo.ports[0]?.host) {
    host = (gateway.host && gateway.host !== 'pending-deploy') ? gateway.host : 'localhost';
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
      apiPort: apiHostPort ?? (gateway.type === 'MANAGED_SSH' ? config.gatewayGrpcPort : null),
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

  log.info(`Deployed instance ${instance.id} (container ${containerInfo.id}) for gateway ${gatewayId}`);

  // Push real-time updates to connected clients
  emitInstancesForGateway(gatewayId).catch(() => {});
  emitGatewayData(gatewayId).catch(() => {});
  emitScalingForGateway(gatewayId).catch(() => {});

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

  log.info(`Removing instance ${instanceId} (container ${instance.containerId}) for gateway ${instance.gatewayId}`);

  await prisma.managedGatewayInstance.update({
    where: { id: instanceId },
    data: { status: ManagedInstanceStatus.REMOVING },
  });

  try {
    await orchestrator.removeContainer(instance.containerId);
  } catch (err) {
    // Container may already be gone — log and proceed with DB cleanup
    log.warn(`Failed to remove container ${instance.containerId}: ${(err as Error).message}`);
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

  log.info(`Removed instance ${instanceId} (container ${instance.containerId})`);

  // Push real-time updates to connected clients
  emitInstancesForGateway(instance.gatewayId).catch(() => {});
  emitGatewayData(instance.gatewayId).catch(() => {});
  emitScalingForGateway(instance.gatewayId).catch(() => {});
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

  log.info(`Scaling gateway ${gatewayId} to ${replicas} replicas`);

  if (gateway.type !== 'MANAGED_SSH' && gateway.type !== 'GUACD' && gateway.type !== 'DB_PROXY') {
    throw new AppError(
      'Only MANAGED_SSH, GUACD, and DB_PROXY gateways can be scaled',
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
        log.error(`Scale-up deploy ${i + 1}/${toCreate} failed: ${(err as Error).message}`);
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
        log.error(`Scale-down remove failed: ${(err as Error).message}`);
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

  log.info(`Scaled gateway ${gatewayId}: ${currentCount} → ${replicas} (deployed: ${deployed}, removed: ${removed})`);

  // Push real-time updates to connected clients
  emitInstancesForGateway(gatewayId).catch(() => {});
  emitGatewayData(gatewayId).catch(() => {});
  emitScalingForGateway(gatewayId).catch(() => {});

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
  if (errorInstances.length > 0) {
    auditService.log({
      userId: null,
      action: 'GATEWAY_RECONCILE',
      targetType: 'Gateway',
      targetId: gatewayId,
      details: {
        action: 'remove_error_instances',
        count: errorInstances.length,
        instanceIds: errorInstances.map(i => i.id),
      },
    });
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
      log.info(`Reconcile: restarted stopped instance ${instance.id}`);
    } catch (err) {
      log.warn(`Reconcile: failed to restart instance ${instance.id}: ${(err as Error).message}`);
      await prisma.managedGatewayInstance.update({
        where: { id: instance.id },
        data: { status: ManagedInstanceStatus.ERROR, errorMessage: (err as Error).message },
      });
    }
  }
  if (stoppedInstances.length > 0) {
    auditService.log({
      userId: null,
      action: 'GATEWAY_RECONCILE',
      targetType: 'Gateway',
      targetId: gatewayId,
      details: {
        action: 'restart_stopped',
        count: stoppedInstances.length,
        instanceIds: stoppedInstances.map(i => i.id),
      },
    });
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
    let deployed = 0;
    for (let i = 0; i < toCreate; i++) {
      try {
        await deployGatewayInstance(gatewayId);
        deployed++;
        log.info(`Reconcile: deployed replacement instance for gateway ${gatewayId}`);
      } catch (err) {
        log.error(`Reconcile: failed to deploy replacement: ${(err as Error).message}`);
      }
    }
    if (deployed > 0) {
      auditService.log({
        userId: null,
        action: 'GATEWAY_RECONCILE',
        targetType: 'Gateway',
        targetId: gatewayId,
        details: {
          action: 'scale_up_replacement',
          desired: gateway.desiredReplicas,
          current: healthyInstances,
          deployed,
        },
      });
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
        log.warn(`Reconcile: failed to remove excess instance: ${(err as Error).message}`);
      }
    }
  }

  // Push real-time updates to connected clients
  emitInstancesForGateway(gatewayId).catch(() => {});
  emitGatewayData(gatewayId).catch(() => {});
  emitScalingForGateway(gatewayId).catch(() => {});
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
      log.error(`Reconcile failed for gateway ${gw.id}: ${(err as Error).message}`);
    }
  }

  if (reconciled > 0 || failed > 0) {
    log.info(`Reconciliation complete: ${reconciled} ok, ${failed} failed`);
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
            healthStatus: info.health === 'none' ? 'healthy' : (info.health ?? 'healthy'),
            lastHealthCheck: new Date(),
            consecutiveFailures: 0,
            status: ManagedInstanceStatus.RUNNING,
            errorMessage: null,
          },
        });

        // Instance recovered from failure — push SSH keys via gRPC
        if (instance.consecutiveFailures > 0) {
          try {
            const gw = await prisma.gateway.findUnique({
              where: { id: instance.gatewayId },
              select: { type: true, tenantId: true },
            });
            if (gw?.type === 'MANAGED_SSH') {
              const keyPair = await prisma.sshKeyPair.findUnique({
                where: { tenantId: gw.tenantId },
                select: { publicKey: true },
              });
              if (keyPair) {
                const grpcPort = config.gatewayGrpcPort;
                const res = await grpcPushKey(instance.host, grpcPort, keyPair.publicKey);
                if (res.ok) {
                  log.info(`Auto-pushed SSH key to recovered instance ${instance.id} (${instance.host}:${grpcPort})`);
                } else {
                  log.warn(`SSH key push to recovered instance ${instance.id} failed: ${res.message}`);
                }
              }
            }
          } catch (pushErr) {
            log.warn(`Failed to auto-push SSH key to recovered instance ${instance.id}: ${pushErr instanceof Error ? pushErr.message : 'Unknown error'}`);
            closeGatewayKeyClient(instance.host, config.gatewayGrpcPort);
          }
        }
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
            log.warn(`Restarted unhealthy instance ${instance.id} after ${HEALTH_CHECK_FAILURE_THRESHOLD} failures`);
            auditService.log({
              userId: null,
              action: 'GATEWAY_RECONCILE',
              targetType: 'ManagedGatewayInstance',
              targetId: instance.id,
              details: {
                action: 'health_restart',
                gatewayId: instance.gatewayId,
                consecutiveFailures: HEALTH_CHECK_FAILURE_THRESHOLD,
              },
            });
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
            auditService.log({
              userId: null,
              action: 'GATEWAY_RECONCILE',
              targetType: 'ManagedGatewayInstance',
              targetId: instance.id,
              details: {
                action: 'health_error',
                gatewayId: instance.gatewayId,
                error: (restartErr as Error).message,
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
    log.info(`Health check: ${healthy} healthy, ${unhealthy} unhealthy, ${restarted} restarted`);
  }

  // Push real-time instance status updates for each affected gateway
  const affectedGatewayIds = [...new Set(instances.map((i) => i.gatewayId))];
  for (const gwId of affectedGatewayIds) {
    emitInstancesForGateway(gwId).catch(() => {});
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
      log.debug(`SSH key push to instance ${instance.id} succeeded`);
      results.push({ instanceId: instance.id, ok: true });
    } catch (err) {
      log.debug(`SSH key push to instance ${instance.id} failed: ${(err as Error).message}`);
      results.push({
        instanceId: instance.id,
        ok: false,
        error: (err as Error).message,
      });
    }
  }

  const succeeded = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  log.info(`SSH key push to ${instances.length} instances: ${succeeded} ok, ${failed} failed`);

  return results;
}

// ---------------------------------------------------------------------------
// Certificate rotation — rolling restart
// ---------------------------------------------------------------------------

/**
 * Perform a rolling restart of all RUNNING instances for a managed gateway
 * so that they pick up a newly rotated mTLS client certificate.
 *
 * Instances are restarted one at a time to avoid total service interruption.
 * Each instance receives the updated TUNNEL_CLIENT_CERT env var before restart.
 */
export async function rollingRestartForCertRotation(
  gatewayId: string,
  newClientCert: string,
): Promise<void> {
  const orchestrator = getOrchestrator();
  if (orchestrator.type === OrchestratorType.NONE) {
    log.warn(`rollingRestartForCertRotation: no orchestrator available for gateway ${gatewayId}`);
    return;
  }

  const instances = await prisma.managedGatewayInstance.findMany({
    where: {
      gatewayId,
      status: ManagedInstanceStatus.RUNNING,
    },
    orderBy: { createdAt: 'asc' },
  });

  if (instances.length === 0) {
    log.info(`rollingRestartForCertRotation: no running instances for gateway ${gatewayId}`);
    return;
  }

  log.info(`rollingRestartForCertRotation: restarting ${instances.length} instance(s) for gateway ${gatewayId}`);

  let restarted = 0;
  let failed = 0;

  for (const instance of instances) {
    try {
      // Inject the new client cert into the container's environment
      await orchestrator.updateContainerEnv(instance.containerId, {
        TUNNEL_CLIENT_CERT: newClientCert,
      });

      await orchestrator.restartContainer(instance.containerId);

      await prisma.managedGatewayInstance.update({
        where: { id: instance.id },
        data: {
          healthStatus: 'restarting',
          lastHealthCheck: new Date(),
          consecutiveFailures: 0,
          errorMessage: null,
        },
      });

      restarted++;
      log.info(`rollingRestartForCertRotation: restarted instance ${instance.id}`);
    } catch (err) {
      failed++;
      log.error(`rollingRestartForCertRotation: failed to restart instance ${instance.id}: ${(err as Error).message}`);

      await prisma.managedGatewayInstance.update({
        where: { id: instance.id },
        data: {
          errorMessage: `Cert rotation restart failed: ${(err as Error).message}`,
        },
      }).catch(() => { /* best-effort */ });
    }
  }

  auditService.log({
    action: 'GATEWAY_RECONCILE',
    targetType: 'Gateway',
    targetId: gatewayId,
    details: {
      action: 'cert_rotation_rolling_restart',
      total: instances.length,
      restarted,
      failed,
    },
  });

  log.info(`rollingRestartForCertRotation: gateway ${gatewayId} — ${restarted} restarted, ${failed} failed`);

  // Emit real-time instance status update
  emitInstancesForGateway(gatewayId).catch(() => {});
}
