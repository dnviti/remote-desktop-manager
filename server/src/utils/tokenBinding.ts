import crypto from 'crypto';
import { Request } from 'express';
import { Socket } from 'socket.io';
import { getClientIp } from './ip';

/**
 * Computes a SHA-256 hash of the client IP and User-Agent for token binding.
 * Used to detect session hijacking (MITRE T1563).
 */
export function computeBindingHash(ip: string, userAgent: string): string {
  return crypto.createHash('sha256').update(`${ip}|${userAgent}`).digest('hex');
}

/** Extracts binding info (IP + User-Agent) from an Express request. */
export function getRequestBinding(req: Request): { ip: string; userAgent: string } {
  return { ip: getClientIp(req), userAgent: req.get('user-agent') ?? '' };
}

/** Extracts the User-Agent string from a Socket.IO handshake. */
export function getSocketUserAgent(socket: Socket): string {
  const ua = socket.handshake.headers['user-agent'];
  return Array.isArray(ua) ? ua[0] ?? '' : ua ?? '';
}
