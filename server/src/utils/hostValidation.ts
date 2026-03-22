import dns from 'dns';
import net from 'net';
import os from 'os';
import { config } from '../config';
import { AppError } from '../middleware/error.middleware';

function getBlockedMessage(): string {
  if (config.allowLoopback && config.allowLocalNetwork) {
    return 'Connections to wildcard, link-local, metadata, or server interface addresses are not allowed';
  }
  if (config.allowLoopback) {
    return 'Connections to local network, wildcard, link-local, metadata, or server interface addresses are not allowed';
  }
  return config.allowLocalNetwork
    ? 'Connections to loopback, wildcard, link-local, metadata, or server interface addresses are not allowed'
    : 'Connections to loopback, local network, wildcard, link-local, metadata, or server interface addresses are not allowed';
}

function getLocalAddresses(): Set<string> {
  const addresses = new Set<string>();
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const info of iface) {
      addresses.add(info.address);
    }
  }
  return addresses;
}

/**
 * Expand an IPv6 address into 8 numeric groups (16-bit each).
 * Handles :: shorthand and zone IDs. Returns null for invalid/IPv4-suffixed addresses.
 */
function expandIPv6(ip: string): number[] | null {
  const addr = ip.replace(/%.*$/, '');
  if (/\d+\.\d+\.\d+\.\d+$/.test(addr)) return null;

  const sides = addr.split('::');
  if (sides.length > 2) return null;

  let groups: number[];
  if (sides.length === 2) {
    const left = sides[0] ? sides[0].split(':').map(s => parseInt(s, 16)) : [];
    const right = sides[1] ? sides[1].split(':').map(s => parseInt(s, 16)) : [];
    const fill = 8 - left.length - right.length;
    if (fill < 0) return null;
    groups = [...left, ...Array(fill).fill(0) as number[], ...right];
  } else {
    groups = addr.split(':').map(s => parseInt(s, 16));
  }

  return groups.length === 8 && groups.every(g => !isNaN(g)) ? groups : null;
}

/**
 * Extract the IPv4 address from an IPv4-mapped IPv6 address.
 * Handles both dotted (::ffff:127.0.0.1) and hex (::ffff:7f00:1) forms.
 * Returns the original IP if not a mapped address.
 */
function extractIPv4FromMapped(ip: string): string {
  if (!net.isIPv6(ip)) return ip;

  const dottedMatch = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (dottedMatch) return dottedMatch[1];

  const hexMatch = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hexMatch) {
    const hi = parseInt(hexMatch[1], 16);
    const lo = parseInt(hexMatch[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }

  return ip;
}

/**
 * Check if an IP is a loopback address. Handles all IPv6 representations
 * (::1, 0:0:0:0:0:0:0:1) and IPv4-mapped loopback (::ffff:127.0.0.1).
 */
function isLoopbackIP(ip: string): boolean {
  const effective = extractIPv4FromMapped(ip);
  if (effective !== ip) return isLoopbackIP(effective);

  if (net.isIPv4(ip)) return ip.split('.').map(Number)[0] === 127;

  if (net.isIPv6(ip)) {
    const groups = expandIPv6(ip);
    if (groups && groups.slice(0, 7).every(g => g === 0) && groups[7] === 1) return true;
  }

  return false;
}

function isForbiddenIP(ip: string, localAddresses: Set<string>): boolean {
  // Normalize IPv4-mapped IPv6 (e.g. ::ffff:192.168.1.1) to plain IPv4
  const effectiveIP = extractIPv4FromMapped(ip);
  if (effectiveIP !== ip) {
    return isForbiddenIP(effectiveIP, localAddresses);
  }

  // Wildcard addresses (always blocked) — handles expanded form too
  if (ip === '0.0.0.0' || ip === '[::]') return true;
  if (net.isIPv6(ip)) {
    const groups = expandIPv6(ip);
    if (groups && groups.every(g => g === 0)) return true;
  }

  // Loopback — blocked unless allowLoopback is enabled
  if (isLoopbackIP(ip)) return !config.allowLoopback;

  // IPv4 checks
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (!config.allowLocalNetwork) {
      if (parts[0] === 10) return true; // 10.0.0.0/8
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
      if (parts[0] === 192 && parts[1] === 168) return true; // 192.168.0.0/16
    }
    if (parts[0] === 169 && parts[1] === 254) return true; // Link-local + metadata (always blocked)
  }

  // IPv6 checks
  if (net.isIPv6(ip)) {
    if (ip.startsWith('fe80:') || ip.startsWith('fe80::')) return true; // Link-local (always blocked)
    if (!config.allowLocalNetwork) {
      if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // ULA
    }
  }

  // Local interface IPs — but exempt loopback IPs when allowLoopback is enabled
  if (localAddresses.has(ip)) {
    if (config.allowLoopback && isLoopbackIP(ip)) return false;
    return true;
  }

  return false;
}

export async function validateHost(host: string): Promise<void> {
  const normalized = host.trim().toLowerCase();

  // Reject "localhost" string — unless allowLoopback is enabled
  if (normalized === 'localhost' && !config.allowLoopback) {
    throw new AppError(getBlockedMessage(), 400);
  }

  const localAddresses = getLocalAddresses();

  // If it's already an IP, check directly
  if (net.isIP(host)) {
    if (isForbiddenIP(host, localAddresses)) {
      throw new AppError(getBlockedMessage(), 400);
    }
    return;
  }

  // Resolve hostname and check all resolved IPs
  try {
    const results = await dns.promises.resolve4(host).catch(() => [] as string[]);
    const results6 = await dns.promises.resolve6(host).catch(() => [] as string[]);
    const allIPs = [...results, ...results6];

    // Also try lookup for names that only resolve via /etc/hosts
    try {
      const lookupResult = await dns.promises.lookup(host, { all: true });
      for (const entry of lookupResult) {
        if (!allIPs.includes(entry.address)) {
          allIPs.push(entry.address);
        }
      }
    } catch {
      // lookup failed — already have resolve results or none
    }

    for (const ip of allIPs) {
      if (isForbiddenIP(ip, localAddresses)) {
        throw new AppError(getBlockedMessage(), 400);
      }
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    // DNS resolution failed (ENOTFOUND etc.) — let it pass,
    // the connection will fail at runtime
  }
}
