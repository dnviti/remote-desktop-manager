import { Request } from 'express';
import { Socket } from 'socket.io';

/**
 * IPv4-mapped IPv6 prefix that Node/Express often prepends.
 */
const V4_MAPPED_PREFIX = '::ffff:';

/**
 * Strip the `::ffff:` prefix from IPv4-mapped IPv6 addresses.
 */
function stripV4Mapped(ip: string): string {
  return ip.startsWith(V4_MAPPED_PREFIX) ? ip.slice(V4_MAPPED_PREFIX.length) : ip;
}

/**
 * Extract the real client IP from an Express request.
 * Uses Express's normalized `req.ip`, which already respects the configured
 * `trust proxy` setting. This keeps all security-sensitive IP decisions on a
 * single trust path instead of manually re-parsing forwarded headers.
 */
export function getClientIp(req: Request): string {
  return stripV4Mapped(req.ip ?? req.socket.remoteAddress ?? '');
}

/**
 * Extract the real client IP from a Socket.IO handshake.
 * Socket.IO does not inherit Express's `req.ip` resolution; use the actual
 * handshake peer address rather than trusting user-controlled forwarded headers.
 */
export function getSocketClientIp(socket: Socket): string {
  return stripV4Mapped(socket.handshake.address);
}
