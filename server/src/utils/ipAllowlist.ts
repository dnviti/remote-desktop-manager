import * as net from 'net';

/**
 * Strip the `::ffff:` IPv4-mapped IPv6 prefix if present.
 */
function stripV4Mapped(ip: string): string {
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

/**
 * Check whether `ip` falls inside the given `cidr` range.
 * Supports both IPv4 (e.g. "10.0.0.0/8") and IPv6 CIDRs.
 * Returns false for any malformed input instead of throwing.
 */
export function isIpInCidr(ip: string, cidr: string): boolean {
  try {
    const clean = stripV4Mapped(ip);
    const slashIdx = cidr.lastIndexOf('/');
    if (slashIdx === -1) {
      // Bare IP — treat as /32 (IPv4) or /128 (IPv6)
      return clean === cidr;
    }

    const base = cidr.slice(0, slashIdx);
    const prefixLen = parseInt(cidr.slice(slashIdx + 1), 10);
    if (isNaN(prefixLen)) return false;

    const ipFamily = net.isIPv4(clean) ? 4 : net.isIPv6(clean) ? 6 : 0;
    const baseFamily = net.isIPv4(base) ? 4 : net.isIPv6(base) ? 6 : 0;
    if (ipFamily === 0 || baseFamily === 0 || ipFamily !== baseFamily) return false;

    if (ipFamily === 4) {
      // Convert IPv4 addresses to 32-bit integers
      const ipInt = ipToInt32(clean);
      const baseInt = ipToInt32(base);
      if (ipInt === null || baseInt === null) return false;
      const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
      return (ipInt & mask) === (baseInt & mask);
    } else {
      // IPv6: compare as two 64-bit halves using BigInt
      const ipBig = ipv6ToBigInt(clean);
      const baseBig = ipv6ToBigInt(base);
      if (ipBig === null || baseBig === null) return false;
      const bits = BigInt(128);
      const prefix = BigInt(prefixLen);
      const mask = prefixLen === 0 ? BigInt(0) : ((BigInt(1) << bits) - BigInt(1)) ^ ((BigInt(1) << (bits - prefix)) - BigInt(1));
      return (ipBig & mask) === (baseBig & mask);
    }
  } catch {
    return false;
  }
}

function ipToInt32(ip: string): number | null {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function ipv6ToBigInt(ip: string): bigint | null {
  try {
    // Expand :: shorthand
    const expanded = expandIPv6(ip);
    if (!expanded) return null;
    const groups = expanded.split(':');
    if (groups.length !== 8) return null;
    let result = BigInt(0);
    for (const g of groups) {
      result = (result << BigInt(16)) | BigInt(parseInt(g, 16));
    }
    return result;
  } catch {
    return null;
  }
}

function expandIPv6(ip: string): string | null {
  if (ip.includes('::')) {
    const sides = ip.split('::');
    if (sides.length !== 2) return null;
    const left = sides[0] ? sides[0].split(':') : [];
    const right = sides[1] ? sides[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    if (missing < 0) return null;
    const middle = Array(missing).fill('0');
    return [...left, ...middle, ...right].join(':');
  }
  return ip;
}

/**
 * Returns true when the IP is permitted by the allowlist.
 * An empty entries array means allow-all (no restriction).
 */
export function isIpAllowed(ip: string, entries: string[]): boolean {
  if (entries.length === 0) return true;
  return entries.some((cidr) => isIpInCidr(ip, cidr));
}

/**
 * Check the tenant's IP allowlist for the given IP address.
 *
 * Returns `{ flagged: false, blocked: false }` when the IP is allowed or the
 * allowlist is disabled. The caller is responsible for logging and rejecting
 * when `blocked` is true, so that a LOGIN_FAILURE audit entry can be written
 * before the request is terminated.
 *
 * - tenantId null/undefined → allow (no tenant context).
 * - allowlist disabled → allow.
 * - IP in list → allow.
 * - IP NOT in list, mode "flag" → flagged: true.
 * - IP NOT in list, mode "block" → blocked: true.
 */
export async function enforceIpAllowlist(
  tenantId: string | null | undefined,
  ip: string,
): Promise<{ flagged: boolean; blocked: boolean }> {
  if (!tenantId) return { flagged: false, blocked: false };

  const { default: prisma } = await import('../lib/prisma');
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { ipAllowlistEnabled: true, ipAllowlistMode: true, ipAllowlistEntries: true },
  });

  if (!tenant || !tenant.ipAllowlistEnabled) return { flagged: false, blocked: false };

  const allowed = isIpAllowed(ip, tenant.ipAllowlistEntries ?? []);
  if (allowed) return { flagged: false, blocked: false };

  if (tenant.ipAllowlistMode === 'block') {
    return { flagged: false, blocked: true };
  }

  // flag mode
  return { flagged: true, blocked: false };
}
