import { Response, NextFunction } from 'express';
import { AuthRequest, assertAuthenticated } from '../types';
import { issueProxyToken, getProxyStatus } from '../services/sshProxy.service';
import { getClientIp } from '../utils/ip';
import { config } from '../config';

/**
 * POST /api/sessions/ssh-proxy/token
 * Issues a short-lived token for native SSH client authentication.
 */
export async function createProxyToken(
  req: AuthRequest,
  res: Response,
  _next: NextFunction,
) {
  assertAuthenticated(req);

  const { connectionId } = req.body as { connectionId: string };
  if (!connectionId) {
    res.status(400).json({ error: 'connectionId is required' });
    return;
  }

  const result = await issueProxyToken(
    req.user.userId,
    connectionId,
    getClientIp(req),
  );

  const proxyPort = config.sshProxy.port;
  // Sanitize hostname — req.hostname is derived from the Host header and
  // can be attacker-controlled. Strip anything that isn't a valid hostname char.
  const rawHost = req.hostname || 'localhost';
  const serverHost = rawHost.replace(/[^a-zA-Z0-9.\-:[\]]/g, '') || 'localhost';

  res.json({
    token: result.token,
    expiresIn: result.expiresIn,
    connectionInstructions: {
      command: `echo "<token>" | nc ${serverHost} ${proxyPort}`,
      port: proxyPort,
      host: serverHost,
      note: 'Present this token as the first line when connecting to the SSH proxy port. The token expires in ' + result.expiresIn + ' seconds.',
    },
  });
}

/**
 * GET /api/sessions/ssh-proxy/status
 * Returns the SSH proxy server status.
 */
export async function proxyStatus(
  req: AuthRequest,
  res: Response,
  _next: NextFunction,
) {
  assertAuthenticated(req);
  const status = getProxyStatus();
  res.json(status);
}
