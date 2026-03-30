import crypto from 'crypto';
import prisma, { ManagedInstanceStatus } from '../lib/prisma';
import type { GatewayType } from '../lib/prisma';
import { AppError } from '../middleware/error.middleware';
import { encrypt, decrypt, requireMasterKey, encryptWithServerKey, decryptWithServerKey } from './crypto.service';
import { config } from '../config';
import { tcpProbe } from '../utils/tcpProbe';
import { buildGatewaySpiffeId } from '../utils/spiffe';
import { startMonitor, startInstanceMonitor, stopMonitor, restartMonitor } from './gatewayMonitor.service';
import { logger } from '../utils/logger';
import {
  generateTunnelToken,
  revokeTunnelToken,
  isTunnelConnected,
  deregisterTunnel,
  getTunnelInfo,
  ensureTunnelConnected,
  refreshTunnelRegistrySnapshot,
} from './tunnel.service';
import { generateCaCert, generateClientCertificate, certFingerprint } from '../utils/certGenerator';
import * as auditService from './audit.service';
import { pushKey as grpcPushKey, closeGatewayKeyClient } from '../utils/gatewayKeyClient';

const log = logger.child('gateway');
import { removeGatewayInstance } from './managedGateway.service';

export interface CreateGatewayInput {
  name: string;
  type: GatewayType;
  host: string;
  port: number;
  description?: string;
  isDefault?: boolean;
  username?: string;
  password?: string;
  sshPrivateKey?: string;
  apiPort?: number;
  publishPorts?: boolean;
  lbStrategy?: 'ROUND_ROBIN' | 'LEAST_CONNECTIONS';
  monitoringEnabled?: boolean;
  monitorIntervalMs?: number;
  inactivityTimeoutSeconds?: number;
}

export interface UpdateGatewayInput {
  name?: string;
  host?: string;
  port?: number;
  description?: string | null;
  isDefault?: boolean;
  username?: string;
  password?: string;
  sshPrivateKey?: string;
  apiPort?: number | null;
  publishPorts?: boolean;
  lbStrategy?: 'ROUND_ROBIN' | 'LEAST_CONNECTIONS';
  monitoringEnabled?: boolean;
  monitorIntervalMs?: number;
  inactivityTimeoutSeconds?: number;
}

// Fields returned for public gateway responses (no credential columns)
const publicSelect = {
  id: true,
  name: true,
  type: true,
  host: true,
  port: true,
  description: true,
  isDefault: true,
  tenantId: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  encryptedSshKey: true,
  apiPort: true,
  inactivityTimeoutSeconds: true,
  monitoringEnabled: true,
  monitorIntervalMs: true,
  lastHealthStatus: true,
  lastCheckedAt: true,
  lastLatencyMs: true,
  lastError: true,
  isManaged: true,
  publishPorts: true,
  lbStrategy: true,
  desiredReplicas: true,
  autoScale: true,
  minReplicas: true,
  maxReplicas: true,
  sessionsPerInstance: true,
  scaleDownCooldownSeconds: true,
  lastScaleAction: true,
  templateId: true,
  tunnelEnabled: true,
  tunnelConnectedAt: true,
  tunnelClientCertExp: true,
} as const;

export async function getDefaultGateway(tenantId: string, type: GatewayType) {
  return prisma.gateway.findFirst({
    where: { tenantId, type, isDefault: true },
    select: { id: true, type: true, host: true, port: true, isManaged: true, lbStrategy: true, tunnelEnabled: true },
  });
}

export async function listGateways(tenantId: string) {
  await refreshTunnelRegistrySnapshot();
  const gateways = await prisma.gateway.findMany({
    where: { tenantId },
    select: {
      ...publicSelect,
      _count: { select: { managedInstances: true } },
    },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
  });

  const result = await Promise.all(
    gateways.map(async ({ encryptedSshKey, _count, ...gw }) => {
      const base = {
        ...gw,
        hasSshKey: encryptedSshKey != null,
        totalInstances: _count.managedInstances,
        tunnelConnected: gw.tunnelEnabled ? isTunnelConnected(gw.id) : false,
      };
      if (!gw.isManaged || _count.managedInstances === 0) {
        return { ...base, runningInstances: 0 };
      }
      const runningInstances = await prisma.managedGatewayInstance.count({
        where: { gatewayId: gw.id, status: 'RUNNING' },
      });
      return { ...base, runningInstances };
    }),
  );

  log.debug(`Listed ${result.length} gateways for tenant ${tenantId}`);
  return result;
}

export async function createGateway(
  userId: string,
  tenantId: string,
  input: CreateGatewayInput,
) {
  const encData: Record<string, string | null> = {
    encryptedUsername: null,
    usernameIV: null,
    usernameTag: null,
    encryptedPassword: null,
    passwordIV: null,
    passwordTag: null,
    encryptedSshKey: null,
    sshKeyIV: null,
    sshKeyTag: null,
  };

  if (input.type === 'SSH_BASTION') {
    if (input.username || input.password || input.sshPrivateKey) {
      const masterKey = await requireMasterKey(userId);
      if (input.username) {
        const enc = encrypt(input.username, masterKey);
        encData.encryptedUsername = enc.ciphertext;
        encData.usernameIV = enc.iv;
        encData.usernameTag = enc.tag;
      }
      if (input.password) {
        const enc = encrypt(input.password, masterKey);
        encData.encryptedPassword = enc.ciphertext;
        encData.passwordIV = enc.iv;
        encData.passwordTag = enc.tag;
      }
      if (input.sshPrivateKey) {
        const enc = encrypt(input.sshPrivateKey, masterKey);
        encData.encryptedSshKey = enc.ciphertext;
        encData.sshKeyIV = enc.iv;
        encData.sshKeyTag = enc.tag;
      }
    }
  } else if (input.type === 'MANAGED_SSH') {
    if (input.username || input.password || input.sshPrivateKey) {
      throw new AppError('MANAGED_SSH gateways use the server-managed key pair. Do not supply credentials.', 400);
    }
    const keyPair = await prisma.sshKeyPair.findUnique({ where: { tenantId } });
    if (!keyPair) {
      throw new AppError('Cannot create MANAGED_SSH gateway: no SSH key pair generated for this tenant. Generate one first.', 400);
    }
  } else if (input.type === 'DB_PROXY') {
    if (input.username || input.password || input.sshPrivateKey) {
      throw new AppError('DB_PROXY gateways do not use direct credentials. Credentials are injected per-session from the vault.', 400);
    }
  } else if (input.username || input.password || input.sshPrivateKey) {
    throw new AppError('Credentials can only be set for SSH_BASTION gateways', 400);
  }

  const gateway = await prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.gateway.updateMany({
        where: { tenantId, type: input.type, isDefault: true },
        data: { isDefault: false },
      });
    }

    const row = await tx.gateway.create({
      data: {
        name: input.name,
        type: input.type,
        host: input.host,
        port: input.port,
        description: input.description ?? null,
        isDefault: input.isDefault ?? false,
        apiPort: input.type === 'MANAGED_SSH' ? (input.apiPort ?? config.gatewayGrpcPort) : null,
        monitoringEnabled: input.monitoringEnabled ?? true,
        monitorIntervalMs: input.monitorIntervalMs ?? 5000,
        inactivityTimeoutSeconds: input.inactivityTimeoutSeconds ?? 3600,
        publishPorts: input.publishPorts ?? false,
        lbStrategy: input.lbStrategy ?? 'ROUND_ROBIN',
        tenantId,
        createdById: userId,
        ...encData,
      },
      select: publicSelect,
    });
    const { encryptedSshKey: _k, ...rest } = row;
    return { ...rest, hasSshKey: _k != null };
  });

  log.debug(`Created gateway ${gateway.id} (${input.type}) in tenant ${tenantId}`);

  // Use persisted values from the database result instead of raw input
  // to ensure we operate on the actual stored state.
  const isManagedPublished = gateway.publishPorts && (gateway.type === 'MANAGED_SSH' || gateway.type === 'GUACD' || gateway.type === 'DB_PROXY');
  if (gateway.monitoringEnabled && isManagedPublished) {
    startInstanceMonitor(gateway.id, tenantId, gateway.monitorIntervalMs);
  } else if (gateway.monitoringEnabled && !isManagedPublished) {
    startMonitor(gateway.id, gateway.host, gateway.port, tenantId, gateway.monitorIntervalMs);
  }

  return gateway;
}

export async function updateGateway(
  userId: string,
  tenantId: string,
  gatewayId: string,
  input: UpdateGatewayInput,
) {
  const existing = await prisma.gateway.findFirst({
    where: { id: gatewayId, tenantId },
  });
  if (!existing) throw new AppError('Gateway not found', 404);

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.host !== undefined) data.host = input.host;
  if (input.port !== undefined) data.port = input.port;
  if (input.description !== undefined) data.description = input.description;
  if (input.apiPort !== undefined) data.apiPort = input.apiPort;
  if (input.monitoringEnabled !== undefined) data.monitoringEnabled = input.monitoringEnabled;
  if (input.monitorIntervalMs !== undefined) data.monitorIntervalMs = input.monitorIntervalMs;
  if (input.inactivityTimeoutSeconds !== undefined) data.inactivityTimeoutSeconds = input.inactivityTimeoutSeconds;
  if (input.publishPorts !== undefined) data.publishPorts = input.publishPorts;
  if (input.lbStrategy !== undefined) data.lbStrategy = input.lbStrategy;

  if (input.username !== undefined || input.password !== undefined || input.sshPrivateKey !== undefined) {
    if (existing.type !== 'SSH_BASTION') {
      throw new AppError('Credentials can only be set for SSH_BASTION gateways', 400);
    }
    const masterKey = await requireMasterKey(userId);
    if (input.username !== undefined) {
      const enc = encrypt(input.username, masterKey);
      data.encryptedUsername = enc.ciphertext;
      data.usernameIV = enc.iv;
      data.usernameTag = enc.tag;
    }
    if (input.password !== undefined) {
      const enc = encrypt(input.password, masterKey);
      data.encryptedPassword = enc.ciphertext;
      data.passwordIV = enc.iv;
      data.passwordTag = enc.tag;
    }
    if (input.sshPrivateKey !== undefined) {
      const enc = encrypt(input.sshPrivateKey, masterKey);
      data.encryptedSshKey = enc.ciphertext;
      data.sshKeyIV = enc.iv;
      data.sshKeyTag = enc.tag;
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (input.isDefault === true && !existing.isDefault) {
      await tx.gateway.updateMany({
        where: { tenantId, type: existing.type, isDefault: true, id: { not: gatewayId } },
        data: { isDefault: false },
      });
      data.isDefault = true;
    } else if (input.isDefault === false) {
      data.isDefault = false;
    }

    const row = await tx.gateway.update({
      where: { id: gatewayId },
      data,
      select: publicSelect,
    });
    const { encryptedSshKey: _k, ...rest } = row;
    return { ...rest, hasSshKey: _k != null };
  });

  log.info(`Updated gateway ${gatewayId} "${existing.name}" in tenant ${tenantId}`);
  log.debug(`Gateway ${gatewayId} updated fields: ${Object.keys(data).join(', ')}`);

  const needsMonitorRestart =
    input.host !== undefined || input.port !== undefined ||
    input.monitorIntervalMs !== undefined || input.monitoringEnabled !== undefined ||
    input.publishPorts !== undefined;

  if (needsMonitorRestart) {
    const current = await prisma.gateway.findUnique({
      where: { id: gatewayId },
      select: { host: true, port: true, type: true, monitorIntervalMs: true, monitoringEnabled: true, publishPorts: true, tenantId: true },
    });
    if (current) {
      const isManagedPublished = current.publishPorts && (current.type === 'MANAGED_SSH' || current.type === 'GUACD' || current.type === 'DB_PROXY');
      if (isManagedPublished) {
        // Stop any existing monitor — TCP probing is meaningless for published-port gateways
        stopMonitor(gatewayId);
      } else {
        restartMonitor(gatewayId, current.host, current.port, current.tenantId, current.monitorIntervalMs, current.monitoringEnabled);
      }
    }
  }

  return updated;
}

export async function deleteGateway(tenantId: string, gatewayId: string, force?: boolean) {
  const existing = await prisma.gateway.findFirst({
    where: { id: gatewayId, tenantId },
  });
  if (!existing) throw new AppError('Gateway not found', 404);

  const connectionCount = await prisma.connection.count({
    where: { gatewayId },
  });
  if (connectionCount > 0 && !force) {
    return { blocked: true as const, connectionCount };
  }

  if (connectionCount > 0) {
    log.info(`Force-deleting gateway ${gatewayId} "${existing.name}" — ${connectionCount} connection(s) will have gatewayId set to null`);
  }

  // Remove all managed container instances before deleting the gateway record
  const instances = await prisma.managedGatewayInstance.findMany({
    where: { gatewayId },
  });
  for (const instance of instances) {
    try {
      await removeGatewayInstance(instance.id);
    } catch (err) {
      log.warn(`Failed to remove managed instance ${instance.id} during gateway deletion: ${(err as Error).message}`);
    }
  }

  await prisma.gateway.delete({ where: { id: gatewayId } });
  stopMonitor(gatewayId);
  log.debug(`Deleted gateway ${gatewayId} in tenant ${tenantId}`);
  return { deleted: true as const, connectionCount };
}

export async function getGatewayCredentials(
  userId: string,
  tenantId: string,
  gatewayId: string,
): Promise<{ username: string | null; password: string | null; sshPrivateKey: string | null }> {
  const gateway = await prisma.gateway.findFirst({
    where: { id: gatewayId, tenantId },
  });
  if (!gateway) throw new AppError('Gateway not found', 404);
  if (gateway.type !== 'SSH_BASTION') {
    return { username: null, password: null, sshPrivateKey: null };
  }

  const masterKey = await requireMasterKey(userId);

  const username =
    gateway.encryptedUsername && gateway.usernameIV && gateway.usernameTag
      ? decrypt(
          { ciphertext: gateway.encryptedUsername, iv: gateway.usernameIV, tag: gateway.usernameTag },
          masterKey,
        )
      : null;

  const password =
    gateway.encryptedPassword && gateway.passwordIV && gateway.passwordTag
      ? decrypt(
          { ciphertext: gateway.encryptedPassword, iv: gateway.passwordIV, tag: gateway.passwordTag },
          masterKey,
        )
      : null;

  const sshPrivateKey =
    gateway.encryptedSshKey && gateway.sshKeyIV && gateway.sshKeyTag
      ? decrypt(
          { ciphertext: gateway.encryptedSshKey, iv: gateway.sshKeyIV, tag: gateway.sshKeyTag },
          masterKey,
        )
      : null;

  log.debug(`Credentials accessed for gateway ${gatewayId} by user ${userId}`);
  return { username, password, sshPrivateKey };
}

export async function testGatewayConnectivity(
  tenantId: string,
  gatewayId: string,
): Promise<{ reachable: boolean; latencyMs: number | null; error: string | null }> {
  const gateway = await prisma.gateway.findFirst({
    where: { id: gatewayId, tenantId },
    select: { host: true, port: true, type: true, publishPorts: true },
  });
  if (!gateway) throw new AppError('Gateway not found', 404);

  let probeHost = gateway.host;
  let probePort = gateway.port;

  // For managed+publishPorts gateways, probe the first running instance instead
  // of the gateway-level host:port (which is an internal container port).
  const isManagedPublished = gateway.publishPorts && (gateway.type === 'MANAGED_SSH' || gateway.type === 'GUACD' || gateway.type === 'DB_PROXY');
  if (isManagedPublished) {
    const instance = await prisma.managedGatewayInstance.findFirst({
      where: { gatewayId, status: 'RUNNING' },
      select: { host: true, port: true },
      orderBy: { createdAt: 'asc' },
    });
    if (instance) {
      probeHost = instance.host;
      probePort = instance.port;
    }
  }

  const result = await tcpProbe(probeHost, probePort, 5000);

  log.info(`Connectivity test for gateway ${gatewayId}: ${result.reachable ? 'REACHABLE' : 'UNREACHABLE'} at ${probeHost}:${probePort}${result.latencyMs != null ? ` (${result.latencyMs}ms)` : ''}`);

  await prisma.gateway.update({
    where: { id: gatewayId },
    data: {
      lastHealthStatus: result.reachable ? 'REACHABLE' : 'UNREACHABLE',
      lastCheckedAt: new Date(),
      lastLatencyMs: result.latencyMs,
      lastError: result.error,
    },
  });

  return result;
}

export async function pushKeyToAllManagedGateways(
  tenantId: string,
): Promise<{ gatewayId: string; name: string; ok: boolean; error?: string }[]> {
  const gateways = await prisma.gateway.findMany({
    where: { tenantId, type: 'MANAGED_SSH', isManaged: true },
    select: { id: true, name: true },
  });

  log.info(`Pushing SSH key to all managed gateways (${gateways.length} gateways) in tenant ${tenantId}`);

  const results: { gatewayId: string; name: string; ok: boolean; error?: string }[] = [];
  for (const gw of gateways) {
    try {
      await pushKeyToGateway(tenantId, gw.id);
      results.push({ gatewayId: gw.id, name: gw.name, ok: true });
    } catch (err) {
      results.push({ gatewayId: gw.id, name: gw.name, ok: false, error: (err as Error).message });
    }
  }

  const ok = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  log.info(`SSH key push to all gateways complete: ${ok} ok, ${failed} failed`);

  return results;
}

export interface PushKeyInstanceResult {
  instanceId: string;
  ok: boolean;
  error?: string;
}

export async function pushKeyToGateway(
  tenantId: string,
  gatewayId: string,
): Promise<PushKeyInstanceResult[]> {
  const gateway = await prisma.gateway.findFirst({
    where: { id: gatewayId, tenantId },
    select: { type: true },
  });
  if (!gateway) throw new AppError('Gateway not found', 404);
  if (gateway.type !== 'MANAGED_SSH') {
    throw new AppError('Push key is only supported for MANAGED_SSH gateways', 400);
  }

  const keyPair = await prisma.sshKeyPair.findUnique({
    where: { tenantId },
    select: { publicKey: true },
  });
  if (!keyPair) {
    throw new AppError('No SSH key pair found for this tenant. Generate one first.', 404);
  }

  const grpcPort = config.gatewayGrpcPort;

  const instances = await prisma.managedGatewayInstance.findMany({
    where: {
      gatewayId,
      status: ManagedInstanceStatus.RUNNING,
    },
    select: { id: true, host: true },
  });

  if (instances.length === 0) {
    // No managed instances — try direct push to the gateway host.
    // This handles static containers (Ansible dev compose) and external gateways.
    const directGw = await prisma.gateway.findFirst({
      where: { id: gatewayId, tenantId },
      select: { host: true, apiPort: true },
    });

    if (directGw?.host) {
      const directPort = directGw.apiPort || grpcPort;
      log.info(`No managed instances — pushing key directly to gateway ${gatewayId} at ${directGw.host}:${directPort}`);

      try {
        const result = await grpcPushKey(directGw.host, directPort, keyPair.publicKey);
        if (!result.ok) {
          throw new AppError(`Key push failed: ${result.message}`, 502);
        }
        return [{ instanceId: 'direct', ok: true }];
      } catch (err) {
        if (err instanceof AppError) throw err;
        closeGatewayKeyClient(directGw.host, directPort);
        throw new AppError(`Key push to ${directGw.host}:${directPort} failed: ${(err as Error).message}`, 502);
      }
    }

    throw new AppError('No running instances and no host configured for this gateway', 400);
  }

  log.info(`Pushing SSH key to gateway ${gatewayId} via gRPC (${instances.length} instances)`);

  const results: PushKeyInstanceResult[] = [];

  for (const instance of instances) {
    try {
      const res = await grpcPushKey(instance.host, grpcPort, keyPair.publicKey);
      if (res.ok) {
        log.debug(`gRPC key push to instance ${instance.id} (${instance.host}:${grpcPort}) succeeded`);
        results.push({ instanceId: instance.id, ok: true });
      } else {
        log.debug(`gRPC key push to instance ${instance.id} (${instance.host}:${grpcPort}) failed: ${res.message}`);
        results.push({ instanceId: instance.id, ok: false, error: res.message });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      log.debug(`gRPC key push to instance ${instance.id} (${instance.host}:${grpcPort}) failed: ${msg}`);
      // Invalidate the cached client on connection errors
      closeGatewayKeyClient(instance.host, grpcPort);
      results.push({ instanceId: instance.id, ok: false, error: msg });
    }
  }

  const allFailed = results.every(r => !r.ok);
  if (allFailed) {
    throw new AppError(
      `SSH key push failed for all ${results.length} instance(s)`,
      502,
    );
  }

  return results;
}

export async function pushKeysToAllTenantGateways(): Promise<void> {
  const tenants = await prisma.sshKeyPair.findMany({
    select: { tenantId: true, tenant: { select: { name: true } } },
  });

  if (tenants.length === 0) {
    log.info('[startup] No tenants with SSH key pairs — skipping gateway key push');
    return;
  }

  log.info(`[startup] Pushing SSH keys to all managed gateways for ${tenants.length} tenant(s)`);

  let ok = 0;
  let failed = 0;

  for (const { tenantId, tenant } of tenants) {
    try {
      const results = await pushKeyToAllManagedGateways(tenantId);
      const tenantOk = results.filter(r => r.ok).length;
      const tenantFailed = results.filter(r => !r.ok).length;
      if (tenantFailed > 0) {
        log.warn(`[startup] Key push for tenant "${tenant.name}": ${tenantOk} ok, ${tenantFailed} failed`);
      }
      ok += tenantOk;
      failed += tenantFailed;
    } catch (err) {
      failed++;
      log.warn(`[startup] Key push failed for tenant "${tenant.name}": ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  log.info(`[startup] Gateway key push complete: ${ok} ok, ${failed} failed`);
}

// ---------------------------------------------------------------------------
// Tunnel token management (delegates to tunnel.service)
// ---------------------------------------------------------------------------

export async function generateGatewayTunnelToken(
  tenantId: string,
  gatewayId: string,
  operatorUserId: string,
): Promise<{ token: string; tunnelEnabled: boolean }> {
  const gateway = await prisma.gateway.findFirst({
    where: { id: gatewayId, tenantId },
    select: {
      id: true,
      tenantId: true,
      tunnelClientCert: true,
      tenant: {
        select: {
          tunnelCaCert: true,
        },
      },
    },
  });
  if (!gateway) throw new AppError('Gateway not found', 404);

  // Auto-generate mTLS certificates if not already present
  if (!gateway.tenant.tunnelCaCert || !gateway.tunnelClientCert) {
    await ensureMtlsCerts(tenantId, gatewayId, operatorUserId);
  }

  return generateTunnelToken(gatewayId, operatorUserId);
}

/**
 * Ensure a tenant CA and gateway leaf certificate exist.
 * The tenant CA is generated once at tenant creation; this method also performs
 * a lazy backfill for pre-existing tenants that do not yet have CA material.
 */
async function ensureMtlsCerts(
  tenantId: string,
  gatewayId: string,
  operatorUserId: string,
): Promise<void> {
  const { caFingerprintResult, clientExpiry, tenantCaGenerated } = await prisma.$transaction(async (tx) => {
    // Serialize tenant-CA backfill to avoid duplicate CAs for older tenants.
    const lockKey = BigInt('0x' + crypto.createHash('md5').update(tenantId).digest('hex').slice(0, 15));
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: {
        tunnelCaCert: true,
        tunnelCaKey: true,
        tunnelCaKeyIV: true,
        tunnelCaKeyTag: true,
        tunnelCaCertFingerprint: true,
      },
    });
    if (!tenant) throw new AppError('Tenant not found', 404);

    let caCertPem: string;
    let caKeyPem: string;
    let caFingerprint: string;
    let tenantCaGenerated = false;

    if (tenant.tunnelCaCert && tenant.tunnelCaKey && tenant.tunnelCaKeyIV && tenant.tunnelCaKeyTag) {
      caCertPem = tenant.tunnelCaCert;
      caKeyPem = decryptTenantCaKey(tenant);
      caFingerprint = tenant.tunnelCaCertFingerprint ?? certFingerprint(caCertPem);
    } else {
      const ca = generateCaCert(`arsenale-tenant-${tenantId}`);
      caCertPem = ca.certPem;
      caKeyPem = ca.keyPem;
      caFingerprint = certFingerprint(caCertPem);
      tenantCaGenerated = true;

      const encCaKey = encryptWithServerKey(caKeyPem);
      await tx.tenant.update({
        where: { id: tenantId },
        data: {
          tunnelCaCert: caCertPem,
          tunnelCaKey: encCaKey.ciphertext,
          tunnelCaKeyIV: encCaKey.iv,
          tunnelCaKeyTag: encCaKey.tag,
          tunnelCaCertFingerprint: caFingerprint,
        },
      });

      log.info(`[tunnel] Generated tenant CA for tenant ${tenantId} during gateway ${gatewayId} enrollment`);
    }

    const client = generateClientCertificate(
      caCertPem,
      caKeyPem,
      gatewayId,
      buildGatewaySpiffeId(config.spiffeTrustDomain, gatewayId),
      90,
    );
    const encClientKey = encryptWithServerKey(client.keyPem);

    await tx.gateway.update({
      where: { id: gatewayId },
      data: {
        tunnelClientCert: client.certPem,
        tunnelClientKey: encClientKey.ciphertext,
        tunnelClientKeyIV: encClientKey.iv,
        tunnelClientKeyTag: encClientKey.tag,
        tunnelClientCertExp: client.expiry,
      },
    });

    return {
      caFingerprintResult: caFingerprint,
      clientExpiry: client.expiry,
      tenantCaGenerated,
    };
  }, { isolationLevel: 'Serializable' });

  auditService.log({
    userId: operatorUserId,
    action: 'TUNNEL_TOKEN_GENERATE',
    targetType: 'Gateway',
    targetId: gatewayId,
    details: {
      mtlsCertsGenerated: true,
      tenantId,
      tenantCaGenerated,
      caFingerprint: caFingerprintResult.slice(0, 16),
      clientCertExpiry: clientExpiry.toISOString(),
    },
  });

  log.info(`[tunnel] mTLS certs generated for gateway ${gatewayId} (client cert expires ${clientExpiry.toISOString()})`);
}

/** Helper to decrypt an encrypted tenant CA key. */
function decryptTenantCaKey(tenant: {
  tunnelCaKey: string | null;
  tunnelCaKeyIV: string | null;
  tunnelCaKeyTag: string | null;
}): string {
  if (!tenant.tunnelCaKey || !tenant.tunnelCaKeyIV || !tenant.tunnelCaKeyTag) {
    throw new Error('Tenant CA key material is incomplete');
  }
  return decryptWithServerKey({
    ciphertext: tenant.tunnelCaKey,
    iv: tenant.tunnelCaKeyIV,
    tag: tenant.tunnelCaKeyTag,
  });
}

export async function revokeGatewayTunnelToken(
  tenantId: string,
  gatewayId: string,
  operatorUserId: string,
): Promise<void> {
  const existing = await prisma.gateway.findFirst({
    where: { id: gatewayId, tenantId },
    select: { id: true },
  });
  if (!existing) throw new AppError('Gateway not found', 404);

  return revokeTunnelToken(gatewayId, operatorUserId);
}

export async function getTunnelOverview(tenantId: string) {
  await refreshTunnelRegistrySnapshot();
  const gateways = await prisma.gateway.findMany({
    where: { tenantId, tunnelEnabled: true },
    select: { id: true },
  });

  let connected = 0;
  let disconnected = 0;
  let rttSum = 0;
  let rttCount = 0;

  for (const gw of gateways) {
    const info = getTunnelInfo(gw.id);
    if (info) {
      connected++;
      if (info.pingPongLatency != null) {
        rttSum += info.pingPongLatency;
        rttCount++;
      }
    } else {
      disconnected++;
    }
  }

  return {
    total: gateways.length,
    connected,
    disconnected,
    avgRttMs: rttCount > 0 ? Math.round(rttSum / rttCount) : null,
  };
}

export async function forceDisconnectTunnel(
  tenantId: string,
  gatewayId: string,
): Promise<void> {
  const existing = await prisma.gateway.findFirst({
    where: { id: gatewayId, tenantId },
    select: { id: true },
  });
  if (!existing) throw new AppError('Gateway not found', 404);

  if (!await ensureTunnelConnected(gatewayId)) {
    throw new AppError('Tunnel is not connected', 400);
  }

  deregisterTunnel(gatewayId);
}

export async function getTunnelEvents(
  tenantId: string,
  gatewayId: string,
): Promise<Array<{ action: string; timestamp: Date; details: unknown; ipAddress: string | null }>> {
  const existing = await prisma.gateway.findFirst({
    where: { id: gatewayId, tenantId },
    select: { id: true },
  });
  if (!existing) throw new AppError('Gateway not found', 404);

  const events = await prisma.auditLog.findMany({
    where: {
      targetId: gatewayId,
      targetType: 'Gateway',
      action: { in: ['TUNNEL_CONNECT', 'TUNNEL_DISCONNECT'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      action: true,
      createdAt: true,
      details: true,
      ipAddress: true,
    },
  });

  return events.map((e: { action: string; createdAt: Date; details: unknown; ipAddress: string | null }) => {
    // Only expose known-safe fields from audit details to prevent information leakage
    let safeDetails: Record<string, unknown> | null = null;
    if (e.details && typeof e.details === 'object' && !Array.isArray(e.details)) {
      const d = e.details as Record<string, unknown>;
      safeDetails = {};
      if ('clientVersion' in d) safeDetails.clientVersion = String(d.clientVersion);
      if ('forced' in d) safeDetails.forced = Boolean(d.forced);
    }
    return {
      action: e.action,
      timestamp: e.createdAt,
      details: safeDetails,
      ipAddress: e.ipAddress,
    };
  });
}

export async function getTunnelMetrics(
  tenantId: string,
  gatewayId: string,
) {
  const existing = await prisma.gateway.findFirst({
    where: { id: gatewayId, tenantId },
    select: { id: true },
  });
  if (!existing) throw new AppError('Gateway not found', 404);

  await refreshTunnelRegistrySnapshot();
  return getTunnelInfo(gatewayId);
}
