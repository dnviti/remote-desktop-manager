import dns from 'dns';
import net from 'net';
import os from 'os';
import { config } from '../config';
import { AppError } from '../middleware/error.middleware';

function getBlockedMessage(): string {
  if (config.allowLoopback && config.allowLocalNetwork) {
    return 'Connections to wildcard, link-local, or metadata addresses are not allowed';
  }
  if (config.allowLoopback) {
    return 'Connections to local network addresses are not allowed';
  }
  return config.allowLocalNetwork
    ? 'Connections to loopback addresses are not allowed'
    : 'Connections to loopback or local network addresses are not allowed';
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

function isLoopbackIP(ip: string): boolean {
  if (ip === '::1') return true;
  if (net.isIPv4(ip) && ip.split('.').map(Number)[0] === 127) return true;
  return false;
}

function isForbiddenIP(ip: string, localAddresses: Set<string>): boolean {
  // Wildcard addresses (always blocked)
  if (ip === '0.0.0.0' || ip === '::' || ip === '[::]') return true;

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
