import prisma from '../lib/prisma';
import { config } from '../config';
import { AppError } from '../middleware/error.middleware';
import { getConnection, getConnectionCredentials } from './connection.service';
import { resolveDomainCredentials } from './domain.service';
import { getGatewayCredentials } from './gateway.service';
import { selectInstance } from './loadBalancer.service';
import { getPrivateKey as getTenantPrivateKey } from './sshkey.service';
import * as sessionService from './session.service';
import { createTcpProxy, ensureTunnelConnected } from './tunnel.service';
import type { DlpPolicy, ResolvedDlpPolicy } from '../types';
import type { EnforcedConnectionSettings } from '../schemas/tenant.schemas';
import { resolveDlpPolicy } from '../utils/dlp';

type CredentialSource = 'saved' | 'domain' | 'manual';

function isManagedGroup(deploymentMode: string | null | undefined, legacyIsManaged: boolean | null | undefined): boolean {
  if (deploymentMode) return deploymentMode === 'MANAGED_GROUP';
  return Boolean(legacyIsManaged);
}

interface IssueSshGrantInput {
  userId: string;
  tenantId?: string;
  connectionId: string;
  username?: string;
  password?: string;
  credentialMode?: 'saved' | 'domain' | 'manual';
  ipAddress?: string | null;
}

interface TerminalGrantEndpoint {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

interface IssuedTerminalGrant {
  token: string;
  expiresAt: string;
}

interface SessionPolicySnapshot {
  dlpPolicy: ResolvedDlpPolicy;
  enforcedSshSettings: Partial<Record<string, unknown>> | null;
}

export interface TerminalBrokerSshSession {
  transport: 'terminal-broker';
  sessionId: string;
  token: string;
  expiresAt: string;
  dlpPolicy: ResolvedDlpPolicy;
  enforcedSshSettings: Partial<Record<string, unknown>> | null;
  sftpSupported: false;
}

export type SshSessionStartResult = TerminalBrokerSshSession;

export async function startSshSession(input: IssueSshGrantInput): Promise<SshSessionStartResult> {
  const connection = await getConnection(input.userId, input.connectionId, input.tenantId);
  if (connection.type !== 'SSH') {
    throw new AppError('Not an SSH connection', 400);
  }

  const policies = await loadSessionPolicy(input.tenantId, connection.dlpPolicy as DlpPolicy | null);
  const gateway = connection.gateway ?? null;

  const credentials = await resolveTargetCredentials(input, connection.id);

  let selectedInstanceId: string | undefined;
  let routingDecision: { strategy: string; candidateCount: number; selectedSessionCount: number } | undefined;
  let bastion: TerminalGrantEndpoint | undefined;

  if (gateway) {
    if (gateway.type !== 'SSH_BASTION' && gateway.type !== 'MANAGED_SSH') {
      throw new AppError('Connection gateway must be SSH_BASTION or MANAGED_SSH for SSH connections', 400);
    }
    if (!input.tenantId) {
      throw new AppError('Tenant context required for gateway routing', 400);
    }

    let bastionHost = gateway.host;
    let bastionPort = gateway.port;
    if (isManagedGroup(gateway.deploymentMode, gateway.isManaged)) {
      const instance = await selectInstance(gateway.id, gateway.lbStrategy);
      if (!instance && !gateway.tunnelEnabled) {
        throw new AppError('No healthy gateway instances available. The gateway may be scaling — please try again.', 503);
      }
      if (instance) {
        bastionHost = instance.host;
        bastionPort = instance.port;
        selectedInstanceId = instance.id;
        routingDecision = {
          strategy: instance.strategy,
          candidateCount: instance.candidateCount,
          selectedSessionCount: instance.selectedSessionCount,
        };
      }
    }

    if (gateway.tunnelEnabled) {
      if (!await ensureTunnelConnected(gateway.id)) {
        throw new AppError('Gateway tunnel is disconnected — the gateway may be unreachable', 503);
      }

      const proxy = await createTcpProxy(gateway.id, '127.0.0.1', bastionPort);
      bastionHost = config.internalServerHost;
      bastionPort = proxy.localPort;
    }

    if (gateway.type === 'MANAGED_SSH') {
      const privateKey = (await getTenantPrivateKey(input.tenantId)).toString('utf8');
      bastion = {
        host: bastionHost,
        port: bastionPort,
        username: 'tunnel',
        privateKey,
      };
    } else {
      const gatewayCreds = await getGatewayCredentials(input.userId, input.tenantId, gateway.id);
      if (!gatewayCreds.username || (!gatewayCreds.password && !gatewayCreds.sshPrivateKey)) {
        throw new AppError(
          'Gateway credentials are incomplete. Please configure username and password or SSH key on the gateway.',
          400,
        );
      }
      bastion = {
        host: bastionHost,
        port: bastionPort,
        username: gatewayCreds.username,
        ...(gatewayCreds.password ? { password: gatewayCreds.password } : {}),
        ...(gatewayCreds.sshPrivateKey ? { privateKey: gatewayCreds.sshPrivateKey } : {}),
      };
    }
  }

  await sessionService.closeStaleSessionsForConnection(input.userId, connection.id, 'SSH');

  const sessionId = await sessionService.startSession({
    userId: input.userId,
    connectionId: connection.id,
    gatewayId: gateway?.id ?? connection.gatewayId ?? undefined,
    instanceId: selectedInstanceId,
    protocol: 'SSH',
    ipAddress: input.ipAddress ?? undefined,
    metadata: {
      host: connection.host,
      port: connection.port,
      credentialSource: credentials.credentialSource,
      transport: 'terminal-broker',
    },
    routingDecision,
  });

  try {
    const issued = await issueTerminalGrant({
      sessionId,
      connectionId: connection.id,
      userId: input.userId,
      target: {
        host: connection.host,
        port: connection.port,
        username: credentials.username,
        ...(credentials.password ? { password: credentials.password } : {}),
        ...(credentials.privateKey ? { privateKey: credentials.privateKey } : {}),
        ...(credentials.passphrase ? { passphrase: credentials.passphrase } : {}),
      },
      ...(bastion ? { bastion } : {}),
      terminal: {
        term: 'xterm-256color',
        cols: 80,
        rows: 24,
      },
      metadata: {
        credentialSource: credentials.credentialSource,
      },
    });

    return {
      transport: 'terminal-broker',
      sessionId,
      token: issued.token,
      expiresAt: issued.expiresAt,
      dlpPolicy: policies.dlpPolicy,
      enforcedSshSettings: policies.enforcedSshSettings,
      sftpSupported: false,
    };
  } catch (error) {
    await sessionService.endSession(sessionId, 'grant_issue_failed');
    throw error;
  }
}

async function resolveTargetCredentials(
  input: IssueSshGrantInput,
  connectionId: string,
): Promise<{
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  credentialSource: CredentialSource;
}> {
  if (input.credentialMode === 'domain') {
    const domainCreds = await resolveDomainCredentials(input.userId);
    if (!domainCreds.domainUsername || !domainCreds.password) {
      throw new AppError('Domain credentials are incomplete. Configure your domain profile in Settings first.', 400);
    }
    return {
      username: domainCreds.domainUsername,
      password: domainCreds.password,
      credentialSource: 'domain',
    };
  }

  if (input.username && input.password) {
    return {
      username: input.username,
      password: input.password,
      credentialSource: 'manual',
    };
  }

  const credentials = await getConnectionCredentials(input.userId, connectionId, input.tenantId);
  return {
    username: credentials.username,
    ...(credentials.password ? { password: credentials.password } : {}),
    ...(credentials.privateKey ? { privateKey: credentials.privateKey } : {}),
    ...(credentials.passphrase ? { passphrase: credentials.passphrase } : {}),
    credentialSource: 'saved',
  };
}

async function loadSessionPolicy(
  tenantId: string | undefined,
  connectionDlp: DlpPolicy | null,
): Promise<SessionPolicySnapshot> {
  const tenant = tenantId
    ? await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          dlpDisableCopy: true,
          dlpDisablePaste: true,
          dlpDisableDownload: true,
          dlpDisableUpload: true,
          enforcedConnectionSettings: true,
        },
      })
    : null;

  const tenantDlp = tenant ?? {
    dlpDisableCopy: false,
    dlpDisablePaste: false,
    dlpDisableDownload: false,
    dlpDisableUpload: false,
  };
  const tenantEnforced = (tenant?.enforcedConnectionSettings as EnforcedConnectionSettings) ?? null;

  return {
    dlpPolicy: resolveDlpPolicy(tenantDlp, connectionDlp),
    enforcedSshSettings: (tenantEnforced?.ssh as Partial<Record<string, unknown>> | undefined) ?? null,
  };
}

async function issueTerminalGrant(grant: Record<string, unknown>): Promise<IssuedTerminalGrant> {
  const response = await fetch(`${config.goTerminalBrokerUrl.replace(/\/+$/, '')}/v1/session-grants:issue`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant }),
  });

  if (!response.ok) {
    let message = `Go terminal broker returned status ${response.status}`;
    try {
      const body = await response.json() as { error?: string };
      if (body?.error) {
        message = body.error;
      }
    } catch {
      // ignore malformed error body
    }
    throw new AppError(message, response.status >= 500 ? 502 : 400);
  }

  return await response.json() as IssuedTerminalGrant;
}
