import prisma, { ManagedInstanceStatus } from '../lib/prisma';
import type { GatewayType } from '../lib/prisma';
import { AppError } from '../middleware/error.middleware';
import { encrypt, decrypt, requireMasterKey } from './crypto.service';
import { config } from '../config';
import { tcpProbe } from '../utils/tcpProbe';
import { startMonitor, startInstanceMonitor, stopMonitor, restartMonitor } from './gatewayMonitor.service';
import { logger } from '../utils/logger';
import { generateTunnelToken, revokeTunnelToken } from './tunnel.service';

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
} as const;

export async function getDefaultGateway(tenantId: string, type: GatewayType) {
  return prisma.gateway.findFirst({
    where: { tenantId, type, isDefault: true },
    select: { id: true, type: true, host: true, port: true, isManaged: true, lbStrategy: true },
  });
}

export async function listGateways(tenantId: string) {
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
      const masterKey = requireMasterKey(userId);
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
        apiPort: input.type === 'MANAGED_SSH' ? (input.apiPort ?? null) : null,
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

  const isManagedPublished = input.publishPorts && (input.type === 'MANAGED_SSH' || input.type === 'GUACD');
  if ((input.monitoringEnabled ?? true) && isManagedPublished) {
    startInstanceMonitor(gateway.id, tenantId, input.monitorIntervalMs ?? 5000);
  } else if ((input.monitoringEnabled ?? true) && !isManagedPublished) {
    startMonitor(gateway.id, input.host, input.port, tenantId, input.monitorIntervalMs ?? 5000);
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
    const masterKey = requireMasterKey(userId);
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
      const isManagedPublished = current.publishPorts && (current.type === 'MANAGED_SSH' || current.type === 'GUACD');
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

  const masterKey = requireMasterKey(userId);

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
  const isManagedPublished = gateway.publishPorts && (gateway.type === 'MANAGED_SSH' || gateway.type === 'GUACD');
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

  const token = config.gatewayApiToken;
  if (!token) {
    throw new AppError('GATEWAY_API_TOKEN is not configured on the server', 500);
  }

  const keyPair = await prisma.sshKeyPair.findUnique({
    where: { tenantId },
    select: { publicKey: true },
  });
  if (!keyPair) {
    throw new AppError('No SSH key pair found for this tenant. Generate one first.', 404);
  }

  const instances = await prisma.managedGatewayInstance.findMany({
    where: {
      gatewayId,
      status: ManagedInstanceStatus.RUNNING,
      apiPort: { not: null },
    },
    select: { id: true, host: true, apiPort: true },
  });

  if (instances.length === 0) {
    throw new AppError('No running instances with an API port found for this gateway', 400);
  }

  log.info(`Pushing SSH key to gateway ${gatewayId} (${instances.length} instances)`);

  const results: PushKeyInstanceResult[] = [];

  for (const instance of instances) {
    const url = `http://${instance.host}:${instance.apiPort}/cgi-bin/authorized-keys`;
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 5000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ publicKey: keyPair.publicKey }),
        signal: ac.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const body = await response.text();
        const error = `HTTP ${response.status}: ${body}`;
        log.debug(`Key push to instance ${instance.id} (${instance.host}:${instance.apiPort}) failed: ${error}`);
        results.push({ instanceId: instance.id, ok: false, error });
      } else {
        log.debug(`Key push to instance ${instance.id} (${instance.host}:${instance.apiPort}) succeeded`);
        results.push({ instanceId: instance.id, ok: true });
      }
    } catch (err) {
      clearTimeout(timeout);
      const msg = (err as Error).name === 'AbortError'
        ? 'Request timed out (5s)'
        : (err as Error).message;
      log.debug(`Key push to instance ${instance.id} (${instance.host}:${instance.apiPort}) failed: ${msg}`);
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

// ---------------------------------------------------------------------------
// Tunnel token management (delegates to tunnel.service)
// ---------------------------------------------------------------------------

export async function generateGatewayTunnelToken(
  tenantId: string,
  gatewayId: string,
  operatorUserId: string,
): Promise<{ token: string; tunnelEnabled: boolean }> {
  const existing = await prisma.gateway.findFirst({
    where: { id: gatewayId, tenantId },
    select: { id: true },
  });
  if (!existing) throw new AppError('Gateway not found', 404);

  return generateTunnelToken(gatewayId, operatorUserId);
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
