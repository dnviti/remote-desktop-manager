import { Response, NextFunction } from 'express';
import path from 'path';
import { mkdir, chmod } from 'fs/promises';
import prisma from '../lib/prisma';
import { AuthRequest, RdpSettings, assertAuthenticated, assertTenantAuthenticated } from '../types';
import type { DlpPolicy, VncSettings } from '../types';
import { getConnection, getConnectionCredentials } from '../services/connection.service';
import { resolveDomainCredentials } from '../services/domain.service';
import { buildRdpGuacamoleSettings, mergeRdpSettings } from '../services/rdp.service';
import { buildVncGuacamoleSettings, mergeVncSettings } from '../services/vnc.service';
import { resolveDlpPolicy } from '../utils/dlp';
import type { EnforcedConnectionSettings } from '../schemas/tenant.schemas';
import * as sessionService from '../services/session.service';
import * as auditService from '../services/audit.service';
import { selectInstance } from '../services/loadBalancer.service';
import { getDefaultGateway } from '../services/gateway.service';
import { ensureTunnelConnected, createTcpProxy, closeTcpProxy } from '../services/tunnel.service';
import { AppError } from '../middleware/error.middleware';
import { forceDisconnectSession } from '../services/sessionCleanup.service';
import { config } from '../config';
import { startRecording, buildRecordingPath } from '../services/recording.service';
import { checkLateralMovement } from '../services/lateralMovement.service';
import { logger } from '../utils/logger';
import { getClientIp } from '../utils/ip';
import type { SessionInput } from '../schemas/session.schemas';
import { startSshSession } from '../services/goTerminalBroker.service';
import { endDesktopSession, heartbeatDesktopSession, issueDesktopSessionGrant } from '../services/goDesktopSession.service';

const DEFAULT_RDP_WIDTH = 1024;
const DEFAULT_RDP_HEIGHT = 768;

function isManagedGroup(deploymentMode: string | null | undefined, legacyIsManaged: boolean | null | undefined): boolean {
  if (deploymentMode) return deploymentMode === 'MANAGED_GROUP';
  return Boolean(legacyIsManaged);
}

// ---- RDP session creation (migrated from rdp.handler.ts) ----

export async function createRdpSession(req: AuthRequest, res: Response, next: NextFunction) {
  // Capture context progressively so we can log whatever is available on failure
  let connectionId: string | undefined;
  let connHost: string | undefined;
  let connPort: number | undefined;
  let gatewayId: string | null | undefined;
  let tunnelProxyServer: import('net').Server | undefined;

  try {
    assertAuthenticated(req);
    const parsed = req.body as SessionInput;
    connectionId = parsed.connectionId;
    const { username: overrideUser, password: overridePass, domain: overrideDomain } = parsed;

    // Lateral movement anomaly detection (MITRE T1021)
    const lmResult = await checkLateralMovement(req.user.userId, connectionId, getClientIp(req));
    if (!lmResult.allowed) {
      throw new AppError(
        'Session denied: anomalous lateral movement detected. ' +
        `${lmResult.distinctTargets} distinct targets in ${lmResult.windowMinutes} min ` +
        `(threshold: ${lmResult.threshold}). Your account has been temporarily suspended.`,
        403,
      );
    }

    const conn = await getConnection(req.user.userId, connectionId, req.user.tenantId);
    connHost = conn.host;
    connPort = conn.port;
    gatewayId = conn.gatewayId;

    if (conn.type !== 'RDP') {
      throw new AppError('Not an RDP connection', 400);
    }

    // Resolve gateway: explicit > tenant default > none
    const gateway = conn.gateway
      ?? (req.user.tenantId ? await getDefaultGateway(req.user.tenantId, 'GUACD') : null);
    if (gateway) gatewayId = gateway.id;

    if (!gateway) {
      auditService.log({
        userId: req.user.userId,
        action: 'SESSION_BLOCKED',
        targetType: 'Connection',
        targetId: connectionId,
        details: { reason: 'no_gateway_available', protocol: 'RDP' },
        ipAddress: getClientIp(req),
      });
      throw new AppError(
        'No gateway available. A connected gateway is required for all connections. Deploy and connect a GUACD gateway to enable RDP sessions.',
        503,
      );
    }

    if (gateway.type !== 'GUACD') {
      throw new AppError('Connection gateway must be of type GUACD for RDP connections', 400);
    }

    let guacdHost: string = gateway.host;
    let guacdPort: number = gateway.port;
    let selectedInstanceId: string | undefined;
    let selectedContainerName: string | undefined;
    let routingDecision: { strategy: string; candidateCount: number; selectedSessionCount: number } | undefined;

    if (isManagedGroup(gateway.deploymentMode, gateway.isManaged)) {
      const inst = await selectInstance(gateway.id, gateway.lbStrategy);
      if (!inst && !gateway.tunnelEnabled) {
        throw new AppError(
          'No healthy gateway instances available. The gateway may be scaling — please try again.',
          503,
        );
      }
      if (inst) {
        guacdHost = inst.host;
        guacdPort = inst.port;
        selectedInstanceId = inst.id;
        selectedContainerName = inst.containerName;
        routingDecision = {
          strategy: inst.strategy,
          candidateCount: inst.candidateCount,
          selectedSessionCount: inst.selectedSessionCount,
        };
      }
    }

    // Tunnel routing: when the gateway has a zero-trust tunnel connected,
    // spin up a local TCP proxy and point guacd at 127.0.0.1:<port>.
    if (gateway.tunnelEnabled) {
      if (!await ensureTunnelConnected(gateway.id)) {
        throw new AppError('Gateway tunnel is disconnected — the gateway may be unreachable', 503);
      }
      const { server, localPort } = await createTcpProxy(gateway.id, '127.0.0.1', guacdPort);
      tunnelProxyServer = server;
      guacdHost = config.goDesktopBrokerEnabled ? config.internalServerHost : '127.0.0.1';
      guacdPort = localPort;
    }

    let username: string;
    let password: string;
    let domain: string | undefined;
    let credentialSource: 'saved' | 'domain' | 'manual' = 'saved';

    if (parsed.credentialMode === 'domain') {
      const domainCreds = await resolveDomainCredentials(req.user.userId);
      if (!domainCreds.domainUsername || !domainCreds.password) {
        throw new AppError('Domain credentials are incomplete. Configure your domain profile in Settings first.', 400);
      }
      username = domainCreds.domainUsername;
      password = domainCreds.password;
      domain = domainCreds.domainName ?? undefined;
      credentialSource = 'domain';
    } else if (overrideUser && overridePass) {
      username = overrideUser;
      password = overridePass;
      domain = overrideDomain;
      credentialSource = 'manual';
    } else {
      const creds = await getConnectionCredentials(req.user.userId, connectionId, req.user.tenantId);
      if (creds.privateKey && !creds.password) {
        throw new AppError('SSH key authentication is not supported for RDP connections', 400);
      }
      username = creds.username;
      password = creds.password;
      domain = creds.domain;
    }

    // Load user RDP defaults and connection RDP settings, then merge
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { rdpDefaults: true },
    });
    const userRdpDefaults = (user?.rdpDefaults as Partial<RdpSettings>) ?? null;
    const connRdpSettings = (conn.rdpSettings as Partial<RdpSettings>) ?? null;

    // Resolve DLP policy: tenant floor + connection override
    const tenantDlp = req.user.tenantId
      ? await prisma.tenant.findUnique({
          where: { id: req.user.tenantId },
          select: { dlpDisableCopy: true, dlpDisablePaste: true, dlpDisableDownload: true, dlpDisableUpload: true, enforcedConnectionSettings: true, recordingEnabled: true },
        })
      : null;
    const tenantEnforced = (tenantDlp?.enforcedConnectionSettings as EnforcedConnectionSettings) ?? null;
    const mergedRdp = mergeRdpSettings(userRdpDefaults, connRdpSettings, tenantEnforced?.rdp);
    const dlpPolicy = resolveDlpPolicy(
      tenantDlp ?? { dlpDisableCopy: false, dlpDisablePaste: false, dlpDisableDownload: false, dlpDisableUpload: false },
      conn.dlpPolicy as DlpPolicy | null,
    );

    const enableDrive = conn.enableDrive ?? false;
    const drivePath = enableDrive
      ? path.posix.join('/guacd-drive', req.user.userId)
      : undefined;

    // Build recording params if enabled (global + tenant-level gate)
    const tenantRecordingEnabled = tenantDlp?.recordingEnabled ?? true;
    let rdpRecording: { recordingPath: string; recordingName: string } | undefined;
    let rdpRecordingId: string | undefined;
    if (config.recordingEnabled && tenantRecordingEnabled) {
      // Force reconnect resize method when recording — display-update can leave the
      // recording without initial graphical content (only mouse cursor visible)
      mergedRdp.resizeMethod = 'reconnect';
      if (!mergedRdp.width) {
        mergedRdp.width = DEFAULT_RDP_WIDTH;
        mergedRdp.height = DEFAULT_RDP_HEIGHT;
      }
      try {
        const recGatewayDir = selectedContainerName || 'default';
        const recFilePath = buildRecordingPath(req.user.userId, connectionId, 'RDP', 'guac', recGatewayDir);
        // Pre-create directory (guacd's create-recording-path is non-recursive)
        const recDir = path.dirname(recFilePath);
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        await mkdir(recDir, { recursive: true });
        // Make dirs writable by guacd container (runs as different UID)
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        await chmod(recDir, 0o777);
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        await chmod(path.dirname(recDir), 0o777);
        // All guacd instances mount recordings at /recordings (compose volume or managed bind mount)
        const guacdPath = recFilePath.replace(config.recordingPath, '/recordings');
        rdpRecording = { recordingPath: path.dirname(guacdPath), recordingName: path.basename(guacdPath) };
        rdpRecordingId = await startRecording({
          userId: req.user.userId,
          connectionId,
          protocol: 'RDP',
          format: 'guac',
          filePath: recFilePath,
          width: mergedRdp.width,
          height: mergedRdp.height,
        });
        logger.info(`[recording] Started RDP recording ${rdpRecordingId} for connection ${connectionId} (gateway: ${recGatewayDir})`);
        logger.debug(`[recording] RDP recording settings: resizeMethod=${mergedRdp.resizeMethod}, width=${mergedRdp.width}, height=${mergedRdp.height}, path=${rdpRecording?.recordingPath}/${rdpRecording?.recordingName}, guacdImage=${config.orchestratorGuacdImage}, disable-gfx=true`);
      } catch (recErr) {
        logger.error('Failed to start RDP recording:', recErr);
      }
    }

    const tokenSettings = buildRdpGuacamoleSettings({
      host: conn.host,
      port: conn.port,
      username,
      password,
      domain,
      enableDrive,
      drivePath,
      rdpSettings: mergedRdp,
      dlpPolicy,
      recording: rdpRecording,
    });

    const desktopGrant = await issueDesktopSessionGrant({
      userId: req.user.userId,
      connectionId,
      gatewayId: gatewayId ?? undefined,
      instanceId: selectedInstanceId,
      protocol: 'RDP',
      ipAddress: getClientIp(req) ?? undefined,
      sessionMetadata: { host: conn.host, port: conn.port, credentialSource },
      ...(routingDecision ? { routingDecision } : {}),
      ...(rdpRecordingId ? { recordingId: rdpRecordingId } : {}),
      token: {
        guacdHost,
        guacdPort,
        settings: tokenSettings,
        metadata: {
          userId: req.user.userId,
          connectionId,
          ipAddress: getClientIp(req) ?? undefined,
          recordingId: rdpRecordingId,
        },
      },
    });

    res.json({
      token: desktopGrant.token,
      enableDrive,
      sessionId: desktopGrant.sessionId,
      recordingId: desktopGrant.recordingId ?? rdpRecordingId,
      dlpPolicy,
    });
  } catch (err) {
    await closeTcpProxy(tunnelProxyServer);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    auditService.log({
      userId: req.user?.userId,
      action: 'SESSION_ERROR',
      targetType: 'Connection',
      targetId: connectionId,
      details: {
        protocol: 'RDP',
        error: errorMessage,
        ...(connHost ? { host: connHost, port: connPort } : {}),
      },
      ipAddress: getClientIp(req),
      gatewayId: gatewayId ?? undefined,
    });

    next(err);
  }
}

// ---- VNC session creation ----

export async function createVncSession(req: AuthRequest, res: Response, next: NextFunction) {
  let connectionId: string | undefined;
  let connHost: string | undefined;
  let connPort: number | undefined;
  let gatewayId: string | null | undefined;
  let tunnelProxyServer: import('net').Server | undefined;

  try {
    assertAuthenticated(req);
    const parsed = req.body as SessionInput;
    connectionId = parsed.connectionId;
    const { username: _overrideUser, password: overridePass } = parsed;

    // Lateral movement anomaly detection (MITRE T1021)
    const lmResult = await checkLateralMovement(req.user.userId, connectionId, getClientIp(req));
    if (!lmResult.allowed) {
      throw new AppError(
        'Session denied: anomalous lateral movement detected. ' +
        `${lmResult.distinctTargets} distinct targets in ${lmResult.windowMinutes} min ` +
        `(threshold: ${lmResult.threshold}). Your account has been temporarily suspended.`,
        403,
      );
    }

    const conn = await getConnection(req.user.userId, connectionId, req.user.tenantId);
    connHost = conn.host;
    connPort = conn.port;
    gatewayId = conn.gatewayId;

    if (conn.type !== 'VNC') {
      throw new AppError('Not a VNC connection', 400);
    }

    // Resolve gateway: explicit > tenant default > none
    const gateway = conn.gateway
      ?? (req.user.tenantId ? await getDefaultGateway(req.user.tenantId, 'GUACD') : null);
    if (gateway) gatewayId = gateway.id;

    if (!gateway) {
      auditService.log({
        userId: req.user.userId,
        action: 'SESSION_BLOCKED',
        targetType: 'Connection',
        targetId: connectionId,
        details: { reason: 'no_gateway_available', protocol: 'VNC' },
        ipAddress: getClientIp(req),
      });
      throw new AppError(
        'No gateway available. A connected gateway is required for all connections. Deploy and connect a GUACD gateway to enable VNC sessions.',
        503,
      );
    }

    if (gateway.type !== 'GUACD') {
      throw new AppError('Connection gateway must be of type GUACD for VNC connections', 400);
    }

    let guacdHost: string = gateway.host;
    let guacdPort: number = gateway.port;
    let selectedInstanceId: string | undefined;
    let selectedContainerName: string | undefined;
    let routingDecision: { strategy: string; candidateCount: number; selectedSessionCount: number } | undefined;

    if (isManagedGroup(gateway.deploymentMode, gateway.isManaged)) {
      const inst = await selectInstance(gateway.id, gateway.lbStrategy);
      if (!inst && !gateway.tunnelEnabled) {
        throw new AppError(
          'No healthy gateway instances available. The gateway may be scaling — please try again.',
          503,
        );
      }
      if (inst) {
        guacdHost = inst.host;
        guacdPort = inst.port;
        selectedInstanceId = inst.id;
        selectedContainerName = inst.containerName;
        routingDecision = {
          strategy: inst.strategy,
          candidateCount: inst.candidateCount,
          selectedSessionCount: inst.selectedSessionCount,
        };
      }
    }

    // Tunnel routing: when the gateway has a zero-trust tunnel connected,
    // spin up a local TCP proxy and point guacd at 127.0.0.1:<port>.
    if (gateway.tunnelEnabled) {
      if (!await ensureTunnelConnected(gateway.id)) {
        throw new AppError('Gateway tunnel is disconnected — the gateway may be unreachable', 503);
      }
      const { server, localPort } = await createTcpProxy(gateway.id, '127.0.0.1', guacdPort);
      tunnelProxyServer = server;
      guacdHost = config.goDesktopBrokerEnabled ? config.internalServerHost : '127.0.0.1';
      guacdPort = localPort;
    }

    // VNC uses only a password (no username typically)
    let password: string;

    if (overridePass) {
      password = overridePass;
    } else {
      const creds = await getConnectionCredentials(req.user.userId, connectionId, req.user.tenantId);
      if (creds.privateKey && !creds.password) {
        throw new AppError('SSH key authentication is not supported for VNC connections', 400);
      }
      password = creds.password;
    }

    const connVncSettings = (conn.vncSettings as Partial<VncSettings>) ?? null;

    // Resolve DLP policy: tenant floor + connection override
    const vncTenantDlp = req.user.tenantId
      ? await prisma.tenant.findUnique({
          where: { id: req.user.tenantId },
          select: { dlpDisableCopy: true, dlpDisablePaste: true, dlpDisableDownload: true, dlpDisableUpload: true, enforcedConnectionSettings: true, recordingEnabled: true },
        })
      : null;
    const vncTenantEnforced = (vncTenantDlp?.enforcedConnectionSettings as EnforcedConnectionSettings) ?? null;
    const mergedVnc = mergeVncSettings(connVncSettings, vncTenantEnforced?.vnc);
    const vncDlpPolicy = resolveDlpPolicy(
      vncTenantDlp ?? { dlpDisableCopy: false, dlpDisablePaste: false, dlpDisableDownload: false, dlpDisableUpload: false },
      conn.dlpPolicy as DlpPolicy | null,
    );

    // Build recording params if enabled (global + tenant-level gate)
    const vncTenantRecordingEnabled = vncTenantDlp?.recordingEnabled ?? true;
    let vncRecording: { recordingPath: string; recordingName: string } | undefined;
    let vncRecordingId: string | undefined;
    if (config.recordingEnabled && vncTenantRecordingEnabled) {
      try {
        const recGatewayDir = selectedContainerName || 'default';
        const recFilePath = buildRecordingPath(req.user.userId, connectionId, 'VNC', 'guac', recGatewayDir);
        // Pre-create directory (guacd's create-recording-path is non-recursive)
        const recDir = path.dirname(recFilePath);
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        await mkdir(recDir, { recursive: true });
        // Make dirs writable by guacd container (runs as different UID)
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        await chmod(recDir, 0o777);
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        await chmod(path.dirname(recDir), 0o777);
        // All guacd instances mount recordings at /recordings (compose volume or managed bind mount)
        const guacdPath = recFilePath.replace(config.recordingPath, '/recordings');
        vncRecording = { recordingPath: path.dirname(guacdPath), recordingName: path.basename(guacdPath) };
        vncRecordingId = await startRecording({
          userId: req.user.userId,
          connectionId,
          protocol: 'VNC',
          format: 'guac',
          filePath: recFilePath,
        });
        logger.info(`[recording] Started VNC recording ${vncRecordingId} for connection ${connectionId} (gateway: ${recGatewayDir})`);
      } catch (recErr) {
        logger.error('Failed to start VNC recording:', recErr);
      }
    }

    const tokenSettings = buildVncGuacamoleSettings({
      host: conn.host,
      port: conn.port,
      password,
      vncSettings: mergedVnc,
      dlpPolicy: vncDlpPolicy,
      recording: vncRecording,
    });

    const desktopGrant = await issueDesktopSessionGrant({
      userId: req.user.userId,
      connectionId,
      gatewayId: gatewayId ?? undefined,
      instanceId: selectedInstanceId,
      protocol: 'VNC',
      ipAddress: getClientIp(req) ?? undefined,
      sessionMetadata: { host: conn.host, port: conn.port },
      ...(routingDecision ? { routingDecision } : {}),
      ...(vncRecordingId ? { recordingId: vncRecordingId } : {}),
      token: {
        guacdHost,
        guacdPort,
        settings: tokenSettings,
        metadata: {
          userId: req.user.userId,
          connectionId,
          ipAddress: getClientIp(req) ?? undefined,
          recordingId: vncRecordingId,
        },
      },
    });

    res.json({
      token: desktopGrant.token,
      sessionId: desktopGrant.sessionId,
      recordingId: desktopGrant.recordingId ?? vncRecordingId,
      dlpPolicy: vncDlpPolicy,
    });
  } catch (err) {
    await closeTcpProxy(tunnelProxyServer);
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    auditService.log({
      userId: req.user?.userId,
      action: 'SESSION_ERROR',
      targetType: 'Connection',
      targetId: connectionId,
      details: {
        protocol: 'VNC',
        error: errorMessage,
        ...(connHost ? { host: connHost, port: connPort } : {}),
      },
      ipAddress: getClientIp(req),
      gatewayId: gatewayId ?? undefined,
    });

    next(err);
  }
}

// ---- SSH access validation (unchanged from rdp.handler.ts) ----

export async function validateSshAccess(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const parsed = req.body as SessionInput;
  const clientIp = getClientIp(req);

  const lmResult = await checkLateralMovement(req.user.userId, parsed.connectionId, clientIp);
  if (!lmResult.allowed) {
    throw new AppError(
      'Session denied: anomalous lateral movement detected. ' +
      `${lmResult.distinctTargets} distinct targets in ${lmResult.windowMinutes} min ` +
      `(threshold: ${lmResult.threshold}). Your account has been temporarily suspended.`,
      403,
    );
  }

  try {
    const result = await startSshSession({
      userId: req.user.userId,
      tenantId: req.user.tenantId,
      connectionId: parsed.connectionId,
      username: parsed.username,
      password: parsed.password,
      credentialMode: parsed.credentialMode,
      ipAddress: clientIp,
    });

    const forwardedProto = req.get?.('x-forwarded-proto')?.split(',')[0]?.trim();
    const forwardedHost = req.get?.('x-forwarded-host')?.split(',')[0]?.trim();
    const host = forwardedHost || req.get?.('host') || req.headers?.host || 'localhost';
    const wsProtocol = forwardedProto === 'https' || req.protocol === 'https' ? 'wss' : 'ws';

    if (result.transport === 'terminal-broker') {
      res.json({
        ...result,
        webSocketPath: '/ws/terminal',
        webSocketUrl: `${wsProtocol}://${host}/ws/terminal?token=${encodeURIComponent(result.token)}`,
      });
      return;
    }

    res.json(result);
  } catch (error) {
    auditService.log({
      userId: req.user.userId,
      action: 'SESSION_ERROR',
      targetType: 'Connection',
      targetId: parsed.connectionId,
      details: {
        protocol: 'SSH',
        error: error instanceof Error ? error.message : 'Failed to issue SSH session',
      },
      ipAddress: clientIp,
    });
    throw error;
  }
}

export async function sshEnd(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const sessionId = req.params.sessionId as string;
  const session = await prisma.activeSession.findUnique({
    where: { id: sessionId },
  });
  if (!session || session.userId !== req.user.userId) {
    throw new AppError('Session not found', 404);
  }
  await sessionService.endSession(sessionId, 'client_disconnect');
  res.json({ ok: true });
}

// ---- RDP heartbeat ----

export async function rdpHeartbeat(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const sessionId = req.params.sessionId as string;
  await heartbeatDesktopSession(sessionId, req.user.userId);
  res.json({ ok: true });
}

// ---- RDP session end ----

export async function rdpEnd(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const sessionId = req.params.sessionId as string;
  await endDesktopSession(sessionId, req.user.userId, 'client_disconnect');
  res.json({ ok: true });
}

// ---- Admin: list active sessions ----

export async function listActiveSessions(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const protocol = req.query.protocol as string | undefined;
  const gatewayId = req.query.gatewayId as string | undefined;

  const sessions = await sessionService.getActiveSessions({
    tenantId: req.user.tenantId,
    protocol: protocol === 'SSH' ? 'SSH' : protocol === 'RDP' ? 'RDP' : protocol === 'VNC' ? 'VNC' : protocol === 'DATABASE' ? 'DATABASE' : protocol === 'DB_TUNNEL' ? 'DB_TUNNEL' : undefined,
    gatewayId,
  });
  res.json(sessions);
}

// ---- Admin: session count ----

export async function getSessionCount(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const count = await sessionService.getActiveSessionCount({
    tenantId: req.user.tenantId,
  });
  res.json({ count });
}

// ---- Admin: session count by gateway ----

export async function getSessionCountByGateway(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const counts = await sessionService.getActiveSessionCountByGateway(req.user.tenantId);
  res.json(counts);
}

// ---- Admin: terminate session ----

export async function terminateSession(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const sessionId = req.params.sessionId as string;
  const session = await prisma.activeSession.findUnique({
    where: { id: sessionId },
    include: { user: { select: { tenantMemberships: { where: { isActive: true }, take: 1, select: { tenantId: true } } } } },
  });
  if (!session || session.user?.tenantMemberships[0]?.tenantId !== req.user.tenantId) {
    throw new AppError('Session not found', 404);
  }
  await sessionService.endSession(sessionId, 'admin_terminated');

  // Force-disconnect the live transport (SSH socket / RDP browser notification)
  forceDisconnectSession({
    id: sessionId,
    protocol: session.protocol,
    socketId: session.socketId,
    userId: session.userId,
  });

  auditService.log({
    userId: req.user.userId,
    action: 'SESSION_TERMINATE',
    targetType: 'Session',
    targetId: sessionId,
    details: {
      terminatedUserId: session.userId,
      protocol: session.protocol,
      connectionId: session.connectionId,
    },
    ipAddress: getClientIp(req),
  });

  res.json({ ok: true });
}
