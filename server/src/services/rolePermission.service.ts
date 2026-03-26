import prisma from '../lib/prisma';
import { Prisma } from '../generated/prisma/client';
import type { TenantRole } from '../generated/prisma/client';
import { AppError } from '../middleware/error.middleware';

// Permission flag names
export type PermissionFlag =
  | 'canConnect'
  | 'canCreateConnections'
  | 'canManageConnections'
  | 'canViewCredentials'
  | 'canShareConnections'
  | 'canViewAuditLog'
  | 'canManageSessions'
  | 'canManageGateways'
  | 'canManageUsers'
  | 'canManageSecrets'
  | 'canManageTenantSettings';

export const ALL_PERMISSION_FLAGS: PermissionFlag[] = [
  'canConnect',
  'canCreateConnections',
  'canManageConnections',
  'canViewCredentials',
  'canShareConnections',
  'canViewAuditLog',
  'canManageSessions',
  'canManageGateways',
  'canManageUsers',
  'canManageSecrets',
  'canManageTenantSettings',
];

const KNOWN_FLAGS = new Set<string>(ALL_PERMISSION_FLAGS);

// Default permissions per role
export const ROLE_DEFAULTS: Record<TenantRole, Record<PermissionFlag, boolean>> = {
  OWNER: {
    canConnect: true, canCreateConnections: true, canManageConnections: true,
    canViewCredentials: true, canShareConnections: true, canViewAuditLog: true,
    canManageSessions: true, canManageGateways: true, canManageUsers: true,
    canManageSecrets: true, canManageTenantSettings: true,
  },
  ADMIN: {
    canConnect: true, canCreateConnections: true, canManageConnections: true,
    canViewCredentials: true, canShareConnections: true, canViewAuditLog: true,
    canManageSessions: true, canManageGateways: true, canManageUsers: true,
    canManageSecrets: true, canManageTenantSettings: false,
  },
  OPERATOR: {
    canConnect: true, canCreateConnections: true, canManageConnections: true,
    canViewCredentials: true, canShareConnections: true, canViewAuditLog: true,
    canManageSessions: true, canManageGateways: true, canManageUsers: false,
    canManageSecrets: true, canManageTenantSettings: false,
  },
  MEMBER: {
    canConnect: true, canCreateConnections: true, canManageConnections: true,
    canViewCredentials: false, canShareConnections: true, canViewAuditLog: false,
    canManageSessions: false, canManageGateways: false, canManageUsers: false,
    canManageSecrets: true, canManageTenantSettings: false,
  },
  CONSULTANT: {
    canConnect: true, canCreateConnections: false, canManageConnections: false,
    canViewCredentials: false, canShareConnections: false, canViewAuditLog: false,
    canManageSessions: false, canManageGateways: false, canManageUsers: false,
    canManageSecrets: false, canManageTenantSettings: false,
  },
  AUDITOR: {
    canConnect: false, canCreateConnections: false, canManageConnections: false,
    canViewCredentials: false, canShareConnections: false, canViewAuditLog: true,
    canManageSessions: true, canManageGateways: false, canManageUsers: false,
    canManageSecrets: false, canManageTenantSettings: false,
  },
  GUEST: {
    canConnect: false, canCreateConnections: false, canManageConnections: false,
    canViewCredentials: false, canShareConnections: false, canViewAuditLog: false,
    canManageSessions: false, canManageGateways: false, canManageUsers: false,
    canManageSecrets: false, canManageTenantSettings: false,
  },
};

/**
 * Resolve permissions: merge role defaults with optional per-user overrides.
 */
export function resolvePermissions(
  role: TenantRole,
  overrides?: Record<string, boolean> | null,
): Record<PermissionFlag, boolean> {
  const defaults = { ...ROLE_DEFAULTS[role] };
  if (!overrides) return defaults;
  for (const [key, value] of Object.entries(overrides)) {
    if (KNOWN_FLAGS.has(key) && typeof value === 'boolean') {
      defaults[key as PermissionFlag] = value;
    }
  }
  return defaults;
}

// ---------------------------------------------------------------------------
// In-memory cache with 30s TTL
// ---------------------------------------------------------------------------
const cache = new Map<string, { permissions: Record<PermissionFlag, boolean>; expiresAt: number }>();
const CACHE_TTL_MS = 30_000;
const CACHE_MAX_SIZE = 10_000;
const CACHE_EVICTION_INTERVAL_MS = 60_000;

// Periodic eviction of expired entries (non-blocking)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
  // If cache still exceeds max size after eviction, clear entirely
  if (cache.size > CACHE_MAX_SIZE) {
    cache.clear();
  }
}, CACHE_EVICTION_INTERVAL_MS).unref();

export function invalidatePermissionCache(userId: string, tenantId: string): void {
  cache.delete(`${userId}:${tenantId}`);
}

/**
 * Invalidate all cached permission entries for a given tenant.
 * Called when a user is disabled/removed to ensure stale entries don't persist.
 */
export function invalidateAllPermissionsForTenant(tenantId: string): void {
  const suffix = `:${tenantId}`;
  for (const key of cache.keys()) {
    if (key.endsWith(suffix)) {
      cache.delete(key);
    }
  }
}

/**
 * Check if a user has a specific permission flag.
 */
export async function hasPermission(
  userId: string,
  tenantId: string,
  flag: PermissionFlag,
): Promise<boolean> {
  const cacheKey = `${userId}:${tenantId}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.permissions[flag];
  }

  const member = await prisma.tenantMember.findUnique({
    where: { tenantId_userId: { tenantId, userId } },
    select: { role: true, permissionOverrides: true, isActive: true },
  });
  if (!member || !member.isActive) return false;

  const permissions = resolvePermissions(
    member.role,
    member.permissionOverrides as Record<string, boolean> | null,
  );
  cache.set(cacheKey, { permissions, expiresAt: Date.now() + CACHE_TTL_MS });
  return permissions[flag];
}

/**
 * Get all resolved permissions for a user (for the UI).
 */
export async function getUserPermissions(
  userId: string,
  tenantId: string,
): Promise<{
  role: TenantRole;
  permissions: Record<PermissionFlag, boolean>;
  overrides: Record<string, boolean> | null;
  defaults: Record<PermissionFlag, boolean>;
} | null> {
  const member = await prisma.tenantMember.findUnique({
    where: { tenantId_userId: { tenantId, userId } },
    select: { role: true, permissionOverrides: true, isActive: true },
  });
  if (!member) return null;

  const overrides = member.permissionOverrides as Record<string, boolean> | null;
  const permissions = resolvePermissions(member.role, overrides);
  const defaults = ROLE_DEFAULTS[member.role];
  return { role: member.role, permissions, overrides: overrides ?? null, defaults };
}

/**
 * Update per-user permission overrides.
 */
export async function updatePermissionOverrides(
  targetUserId: string,
  tenantId: string,
  overrides: Record<string, boolean> | null,
): Promise<void> {
  const member = await prisma.tenantMember.findUnique({
    where: { tenantId_userId: { tenantId, userId: targetUserId } },
    select: { role: true },
  });
  if (!member) throw new AppError('User not found in this organization', 404);

  // OWNER permissions cannot be reduced
  if (member.role === 'OWNER' && overrides) {
    const ownerDefaults = ROLE_DEFAULTS.OWNER;
    for (const [key, value] of Object.entries(overrides)) {
      if (KNOWN_FLAGS.has(key) && ownerDefaults[key as PermissionFlag] === true && value === false) {
        throw new AppError('Cannot reduce permissions for an OWNER', 400);
      }
    }
  }

  // Validate: only known flags
  if (overrides) {
    for (const key of Object.keys(overrides)) {
      if (!KNOWN_FLAGS.has(key)) {
        throw new AppError(`Unknown permission flag: ${key}`, 400);
      }
      if (typeof overrides[key] !== 'boolean') {
        throw new AppError(`Permission flag values must be booleans`, 400);
      }
    }
  }

  // Normalize: strip overrides that match the role default so only true
  // overrides are persisted. If nothing remains, store null.
  // Build from known flags only to satisfy CodeQL property-injection checks.
  let normalized: Record<string, boolean> | null = null;
  if (overrides) {
    const defaults = ROLE_DEFAULTS[member.role];
    const stripped: Record<PermissionFlag, boolean> = {} as Record<PermissionFlag, boolean>;
    for (const flag of ALL_PERMISSION_FLAGS) {
      if (flag in overrides && overrides[flag] !== defaults[flag]) {
        stripped[flag] = overrides[flag] as boolean;
      }
    }
    normalized = Object.keys(stripped).length > 0 ? stripped : null;
  }

  await prisma.tenantMember.update({
    where: { tenantId_userId: { tenantId, userId: targetUserId } },
    data: { permissionOverrides: normalized ?? Prisma.DbNull },
  });
  invalidatePermissionCache(targetUserId, tenantId);
}
