/**
 * RD Gateway Controller
 *
 * Handles HTTP endpoints for the MS-TSGU (RD Gateway) protocol and
 * management operations (status, .rdp file generation).
 */

import { Response } from 'express';
import prisma from '../lib/prisma';
import { AuthRequest, assertAuthenticated } from '../types';
import { AppError } from '../middleware/error.middleware';
import * as rdGatewayService from '../services/rdGateway.service';
import * as abacService from '../services/abac.service';
import { getConnection, getConnectionCredentials } from '../services/connection.service';
import * as auditService from '../services/audit.service';
import { getClientIp } from '../utils/ip';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// RD Gateway status (admin)
// ---------------------------------------------------------------------------

/**
 * GET /api/rdgw/status
 * Returns the current status of the RD Gateway service.
 */
export async function getGatewayStatus(_req: AuthRequest, res: Response) {
  const status = {
    activeTunnels: rdGatewayService.getActiveTunnelCount(),
    activeChannels: rdGatewayService.getActiveChannelCount(),
  };

  res.json(status);
}

// ---------------------------------------------------------------------------
// .rdp file generation
// ---------------------------------------------------------------------------

/**
 * GET /api/rdgw/connections/:connectionId/rdpfile
 * Generates a .rdp file for a connection, pre-configured with gateway settings.
 */
export async function generateRdpFile(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const connectionId = req.params.connectionId as string;

  const conn = await getConnection(req.user.userId, connectionId, req.user.tenantId);
  if (conn.type !== 'RDP') {
    throw new AppError('RDP file generation is only available for RDP connections', 400);
  }

  // Read RDGW config from AppConfig
  const rdgwConfig = await getRdGatewayAppConfig();
  if (!rdgwConfig.enabled) {
    throw new AppError('RD Gateway is not enabled', 400);
  }
  if (!rdgwConfig.externalHostname) {
    throw new AppError('RD Gateway external hostname is not configured', 400);
  }

  // Check ABAC policies
  const usedWebAuthn = req.user.mfaMethod === 'webauthn';
  const completedMfa = !!req.user.mfaMethod;
  const abacCtx: abacService.AbacContext = {
    userId: req.user.userId,
    folderId: conn.folderId,
    teamId: conn.teamId,
    tenantId: req.user.tenantId,
    usedWebAuthnInLogin: usedWebAuthn,
    completedMfaStepUp: completedMfa,
    ipAddress: getClientIp(req),
    connectionId,
  };
  const abacResult = await abacService.evaluate(abacCtx);

  if (!abacResult.allowed) {
    await abacService.logAbacDenial(abacCtx, abacResult);
    throw new AppError('Access denied by policy', 403);
  }

  // Try to get credentials for username pre-fill
  let username: string | undefined;
  let domain: string | undefined;
  try {
    const creds = await getConnectionCredentials(req.user.userId, connectionId, req.user.tenantId);
    username = creds.username;
    domain = creds.domain;
  } catch {
    // Credentials not available (vault locked, etc.) — skip pre-fill
  }

  const rdpContent = rdGatewayService.generateRdpFile({
    connectionName: conn.name,
    targetHost: conn.host,
    targetPort: conn.port,
    gatewayHostname: rdgwConfig.externalHostname,
    gatewayPort: rdgwConfig.port,
    username,
    domain,
    screenMode: 2,
    desktopWidth: 1920,
    desktopHeight: 1080,
  });

  auditService.log({
    userId: req.user.userId,
    action: 'SESSION_START',
    targetType: 'Connection',
    targetId: connectionId,
    details: {
      protocol: 'RDGW',
      operation: 'generateRdpFile',
      connectionName: conn.name,
      targetHost: conn.host,
      targetPort: conn.port,
    },
    ipAddress: getClientIp(req),
  });

  const safeFilename = conn.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  res.setHeader('Content-Type', 'application/x-rdp');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}.rdp"`);
  res.send(rdpContent);
}

// ---------------------------------------------------------------------------
// RD Gateway configuration management
// ---------------------------------------------------------------------------

export interface RdGatewayAppConfig {
  enabled: boolean;
  externalHostname: string;
  port: number;
  idleTimeoutSeconds: number;
}

const RDGW_CONFIG_DEFAULTS: RdGatewayAppConfig = {
  enabled: false,
  externalHostname: '',
  port: 443,
  idleTimeoutSeconds: 3600,
};

/**
 * Read RD Gateway config from AppConfig table.
 */
export async function getRdGatewayAppConfig(): Promise<RdGatewayAppConfig> {
  try {
    const row = await prisma.appConfig.findUnique({
      where: { key: 'rdGatewayConfig' },
    });

    if (!row) return { ...RDGW_CONFIG_DEFAULTS };

    const parsed = JSON.parse(row.value) as Partial<RdGatewayAppConfig>;
    return {
      enabled: parsed.enabled ?? RDGW_CONFIG_DEFAULTS.enabled,
      externalHostname: parsed.externalHostname ?? RDGW_CONFIG_DEFAULTS.externalHostname,
      port: parsed.port ?? RDGW_CONFIG_DEFAULTS.port,
      idleTimeoutSeconds: parsed.idleTimeoutSeconds ?? RDGW_CONFIG_DEFAULTS.idleTimeoutSeconds,
    };
  } catch (err) {
    logger.error('Failed to read RD Gateway config:', err);
    return { ...RDGW_CONFIG_DEFAULTS };
  }
}

/**
 * GET /api/rdgw/config
 * Returns the current RD Gateway configuration.
 */
export async function getConfig(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const cfg = await getRdGatewayAppConfig();
  res.json(cfg);
}

/**
 * PUT /api/rdgw/config
 * Updates the RD Gateway configuration (admin only).
 */
export async function updateConfig(req: AuthRequest, res: Response) {
  assertAuthenticated(req);

  const body = req.body as Partial<RdGatewayAppConfig>;

  const current = await getRdGatewayAppConfig();
  const updated: RdGatewayAppConfig = {
    enabled: body.enabled ?? current.enabled,
    externalHostname: body.externalHostname ?? current.externalHostname,
    port: body.port ?? current.port,
    idleTimeoutSeconds: body.idleTimeoutSeconds ?? current.idleTimeoutSeconds,
  };

  // Validate hostname format if provided
  // eslint-disable-next-line security/detect-unsafe-regex
  if (updated.externalHostname && !/^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(updated.externalHostname)) {
    throw new AppError('Invalid external hostname format', 400);
  }

  // Validate port range
  if (updated.port < 1 || updated.port > 65535) {
    throw new AppError('Port must be between 1 and 65535', 400);
  }

  await prisma.appConfig.upsert({
    where: { key: 'rdGatewayConfig' },
    update: { value: JSON.stringify(updated) },
    create: { key: 'rdGatewayConfig', value: JSON.stringify(updated) },
  });

  auditService.log({
    userId: req.user.userId,
    action: 'APP_CONFIG_UPDATE',
    targetType: 'AppConfig',
    targetId: 'rdGatewayConfig',
    details: {
      previous: current,
      updated,
    },
    ipAddress: getClientIp(req),
  });

  res.json(updated);
}
