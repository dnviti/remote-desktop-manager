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
 * Check whether a single IP token is a private/reserved address.
 */
function isPrivate(ip: string): boolean {
  const clean = stripV4Mapped(ip);
  if (clean === '127.0.0.1' || clean === '::1' || clean === 'localhost') return true;
  if (clean.startsWith('10.') || clean.startsWith('192.168.')) return true;
  if (clean.startsWith('172.')) {
    const second = parseInt(clean.split('.')[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  // IPv6 link-local / unique-local
  if (clean.startsWith('fe80:') || clean.startsWith('fd') || clean.startsWith('fc')) return true;
  return false;
}

/**
 * Given a raw `X-Forwarded-For` value (comma-separated) or a single IP,
 * return the **first public IPv4** address. Falls back to the first
 * entry if no public IPv4 is found.
 */
function extractPublicIp(raw: string): string {
  const parts = raw.split(',').map((s) => stripV4Mapped(s.trim())).filter(Boolean);
  // Prefer the first public IPv4
  const pub = parts.find((p) => !isPrivate(p) && !p.includes(':'));
  if (pub) return pub;
  // Fallback: first public IP of any kind
  const anyPub = parts.find((p) => !isPrivate(p));
  if (anyPub) return anyPub;
  // Last resort: first entry (cleaned)
  return parts[0] ?? raw;
}

/**
 * Extract the real client IP from an Express request.
 * Reads `X-Forwarded-For` first and picks the first public IPv4.
 * Falls back to `req.ip`.
 */
export function getClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  const raw = typeof xff === 'string' ? xff : Array.isArray(xff) ? xff[0] : undefined;
  if (raw) return extractPublicIp(raw);
  return stripV4Mapped(req.ip ?? req.socket.remoteAddress ?? '');
}

/**
 * Extract the real client IP from a Socket.IO handshake.
 * Same logic as `getClientIp` but reads from the handshake headers.
 */
export function getSocketClientIp(socket: Socket): string {
  const xff = socket.handshake.headers['x-forwarded-for'] as string | undefined;
  if (xff) return extractPublicIp(xff);
  return stripV4Mapped(socket.handshake.address);
}
