import dns from 'dns';
import net from 'net';
import os from 'os';
import { AppError } from '../middleware/error.middleware';

const ALLOW_LOCAL_NETWORK = process.env.ALLOW_LOCAL_NETWORK?.toLowerCase() !== 'false';

const BLOCKED_MESSAGE = ALLOW_LOCAL_NETWORK
  ? 'Connections to loopback addresses are not allowed'
  : 'Connections to loopback or local network addresses are not allowed';

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

  // IPv4 checks
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 127) return true; // Loopback (always blocked)
    if (!ALLOW_LOCAL_NETWORK) {
      if (parts[0] === 10) return true; // 10.0.0.0/8
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
      if (parts[0] === 192 && parts[1] === 168) return true; // 192.168.0.0/16
    }
    if (parts[0] === 169 && parts[1] === 254) return true; // Link-local + metadata (always blocked)
  }

  // IPv6 checks
  if (net.isIPv6(ip)) {
    if (ip.startsWith('fe80:') || ip.startsWith('fe80::')) return true; // Link-local (always blocked)
    if (!ALLOW_LOCAL_NETWORK) {
      if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // ULA
    }
  }

  // Local interface IPs (always blocked — prevents connecting to the server itself)
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
