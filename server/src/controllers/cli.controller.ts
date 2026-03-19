/**
 * CLI Controller
 *
 * Lightweight endpoints designed for the Arsenale CLI tool.
 * Provides connection listing and device authorization flow.
 */

import { Request, Response } from 'express';
import { AuthRequest, assertAuthenticated } from '../types';
import * as connectionService from '../services/connection.service';
import * as deviceAuthService from '../services/deviceAuth.service';
import * as auditService from '../services/audit.service';
import { config } from '../config';
import { getClientIp } from '../utils/ip';
import { setRefreshTokenCookie, setCsrfCookie } from '../utils/cookie';

// ---------------------------------------------------------------------------
// Connection listing for CLI
// ---------------------------------------------------------------------------

/**
 * GET /api/cli/connections
 * Returns a lightweight list of connections for the CLI (name, type, host, id).
 */
export async function listConnections(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const result = await connectionService.listConnections(req.user.userId, req.user.tenantId);

  // Flatten own + shared + team connections into a single lightweight list
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pick = (c: any) => ({
    id: c.id as string,
    name: c.name as string,
    type: c.type as string,
    host: c.host as string,
    port: c.port as number,
  });

  const lightweight = [
    ...result.own.map(pick),
    ...result.shared.map(pick),
    ...result.team.map(pick),
  ];

  res.json(lightweight);
}

// ---------------------------------------------------------------------------
// Device Authorization Grant (RFC 8628)
// ---------------------------------------------------------------------------

/**
 * POST /api/cli/auth/device
 * Initiates a device authorization flow.
 * No authentication required -- this is the entry point for CLI login.
 */
export async function initiateDeviceAuth(req: Request, res: Response) {
  const result = await deviceAuthService.initiateDeviceAuth(config.clientUrl);

  auditService.log({
    action: 'DEVICE_AUTH_INITIATED',
    details: {
      userCode: result.user_code,
      clientId: 'arsenale-cli',
    },
    ipAddress: getClientIp(req),
  });

  res.json(result);
}

/**
 * POST /api/cli/auth/device/token
 * CLI polls this endpoint to check if the user has approved the device code.
 * No authentication required -- the device_code serves as the credential.
 */
export async function pollDeviceToken(req: Request, res: Response) {
  const { device_code } = req.body as { device_code: string };
  if (!device_code) {
    res.status(400).json({ error: 'invalid_request', error_description: 'device_code is required' });
    return;
  }

  const result = await deviceAuthService.pollDeviceToken(device_code);

  if ('error' in result) {
    // RFC 8628 specifies 400 for pending/slow_down, 401 for expired
    const status = result.error === 'expired_token' ? 401 : 400;
    res.status(status).json(result);
    return;
  }

  auditService.log({
    userId: result.user.id,
    action: 'DEVICE_AUTH_COMPLETED',
    details: { clientId: 'arsenale-cli' },
    ipAddress: getClientIp(req),
  });

  // Set refresh token cookie for web-based token consumption
  setRefreshTokenCookie(res, result.refresh_token);
  setCsrfCookie(res);

  res.json(result);
}

/**
 * POST /api/cli/auth/device/authorize
 * Authenticated user approves a device code (called from the web UI).
 */
export async function authorizeDevice(req: AuthRequest, res: Response) {
  assertAuthenticated(req);

  const { user_code } = req.body as { user_code: string };
  if (!user_code) {
    res.status(400).json({ error: 'user_code is required' });
    return;
  }

  await deviceAuthService.authorizeDevice(req.user.userId, user_code);
  res.json({ message: 'Device authorized successfully' });
}
