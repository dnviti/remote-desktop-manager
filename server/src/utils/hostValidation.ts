import dns from 'dns';
import net from 'net';
import os from 'os';
import { AppError } from '../middleware/error.middleware';

const BLOCKED_MESSAGE = 'Connections to loopback or local network addresses are not allowed';

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

function isForbiddenIP(ip: string, localAddresses: Set<string>): boolean {
  // Loopback IPv6
  if (ip === '::1') return true;

  // Wildcard addresses
  if (ip === '0.0.0.0' || ip === '::' || ip === '[::]') return true;

  // Loopback IPv4 (127.0.0.0/8)
  if (net.isIPv4(ip)) {
    const firstOctet = parseInt(ip.split('.')[0], 10);
    if (firstOctet === 127) return true;
  }

  // Local interface IPs
  if (localAddresses.has(ip)) return true;

  return false;
}

export async function validateHost(host: string): Promise<void> {
  const normalized = host.trim().toLowerCase();

  // Reject "localhost" string
  if (normalized === 'localhost') {
    throw new AppError(BLOCKED_MESSAGE, 400);
  }

  const localAddresses = getLocalAddresses();

  // If it's already an IP, check directly
  if (net.isIP(host)) {
    if (isForbiddenIP(host, localAddresses)) {
      throw new AppError(BLOCKED_MESSAGE, 400);
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
        throw new AppError(BLOCKED_MESSAGE, 400);
      }
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    // DNS resolution failed (ENOTFOUND etc.) — let it pass,
    // the connection will fail at runtime
  }
}
