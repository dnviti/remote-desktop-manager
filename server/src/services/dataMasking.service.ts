import prisma, { MaskingStrategy, Prisma } from '../lib/prisma';
import { logger } from '../utils/logger';
import type { TenantRoleType } from '../types';
import crypto from 'crypto';

const log = logger.child('data-masking');

// ---- Types ----

export interface MaskingPolicyInput {
  tenantId: string;
  name: string;
  columnPattern: string;
  strategy: MaskingStrategy;
  exemptRoles?: string[];
  scope?: string;
  description?: string;
  enabled?: boolean;
}

export interface MaskingPolicy {
  id: string;
  tenantId: string;
  name: string;
  columnPattern: string;
  strategy: MaskingStrategy;
  exemptRoles: string[];
  scope: string | null;
  description: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MaskedColumn {
  columnName: string;
  strategy: MaskingStrategy;
  policyName: string;
}

// ---- Masking logic ----

/**
 * Get all active masking policies for a tenant.
 * Caches for the duration of a request (caller can cache further).
 */
export async function getActivePolicies(tenantId: string): Promise<MaskingPolicy[]> {
  return prisma.dbMaskingPolicy.findMany({
    where: { tenantId, enabled: true },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Determine which columns in a result set should be masked,
 * considering the user's tenant role for exemptions.
 */
export function findMaskedColumns(
  policies: MaskingPolicy[],
  columnNames: string[],
  userRole: TenantRoleType | undefined,
  database?: string,
  table?: string,
): MaskedColumn[] {
  const masked: MaskedColumn[] = [];

  for (const col of columnNames) {
    for (const policy of policies) {
      // Check scope
      if (policy.scope) {
        const scopeLower = policy.scope.toLowerCase();
        const dbMatch = database && database.toLowerCase() === scopeLower;
        const tableMatch = table && table.toLowerCase() === scopeLower;
        if (!dbMatch && !tableMatch) continue;
      }

      // Check exemptions
      if (userRole && policy.exemptRoles.includes(userRole)) continue;

      // Check pattern match
      try {
        const regex = new RegExp(policy.columnPattern, 'i');
        if (regex.test(col)) {
          masked.push({
            columnName: col,
            strategy: policy.strategy,
            policyName: policy.name,
          });
          break; // First matching policy wins per column
        }
      } catch {
        log.warn(`Invalid regex in masking policy ${policy.id}: ${policy.columnPattern}`);
      }
    }
  }

  return masked;
}

/**
 * Apply masking to a single value based on the masking strategy.
 */
export function maskValue(value: unknown, strategy: MaskingStrategy): string {
  if (value === null || value === undefined) return '***';

  const str = String(value);

  switch (strategy) {
    case 'REDACT':
      return '***REDACTED***';

    case 'HASH':
      return crypto.createHash('sha256').update(str).digest('hex').substring(0, 16);

    case 'PARTIAL': {
      if (str.length <= 4) return '****';
      const visible = Math.min(4, Math.floor(str.length * 0.25));
      return str.substring(0, visible) + '*'.repeat(str.length - visible);
    }

    default:
      return '***REDACTED***';
  }
}

/**
 * Apply masking policies to a row of data.
 * Returns a new object with masked values where applicable.
 */
export function maskRow(
  row: Record<string, unknown>,
  maskedColumns: MaskedColumn[],
): Record<string, unknown> {
  if (maskedColumns.length === 0) return row;

  const maskedColumnMap = new Map(maskedColumns.map((c) => [c.columnName, c.strategy]));
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    const strategy = maskedColumnMap.get(key);
    if (strategy) {
      result[key] = maskValue(value, strategy);
    } else {
      result[key] = value;
    }
  }

  return result;
}

// ---- CRUD operations ----

export async function listPolicies(tenantId: string): Promise<MaskingPolicy[]> {
  return prisma.dbMaskingPolicy.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getPolicy(tenantId: string, policyId: string): Promise<MaskingPolicy | null> {
  return prisma.dbMaskingPolicy.findFirst({
    where: { id: policyId, tenantId },
  });
}

export async function createPolicy(input: MaskingPolicyInput): Promise<MaskingPolicy> {
  // Validate regex pattern
  try {
    new RegExp(input.columnPattern, 'i');
  } catch {
    throw new Error(`Invalid regex pattern: ${input.columnPattern}`);
  }

  return prisma.dbMaskingPolicy.create({
    data: {
      tenantId: input.tenantId,
      name: input.name,
      columnPattern: input.columnPattern,
      strategy: input.strategy,
      exemptRoles: input.exemptRoles ?? [],
      scope: input.scope ?? null,
      description: input.description ?? null,
      enabled: input.enabled ?? true,
    },
  });
}

export async function updatePolicy(
  tenantId: string,
  policyId: string,
  updates: Partial<Omit<MaskingPolicyInput, 'tenantId'>>,
): Promise<MaskingPolicy> {
  // Validate regex pattern if provided
  if (updates.columnPattern) {
    try {
      new RegExp(updates.columnPattern, 'i');
    } catch {
      throw new Error(`Invalid regex pattern: ${updates.columnPattern}`);
    }
  }

  const data: Prisma.DbMaskingPolicyUpdateInput = {};
  if (updates.name !== undefined) data.name = updates.name;
  if (updates.columnPattern !== undefined) data.columnPattern = updates.columnPattern;
  if (updates.strategy !== undefined) data.strategy = updates.strategy;
  if (updates.exemptRoles !== undefined) data.exemptRoles = updates.exemptRoles;
  if (updates.scope !== undefined) data.scope = updates.scope ?? null;
  if (updates.description !== undefined) data.description = updates.description ?? null;
  if (updates.enabled !== undefined) data.enabled = updates.enabled;

  const existing = await prisma.dbMaskingPolicy.findFirst({ where: { id: policyId, tenantId } });
  if (!existing) throw new Error('Masking policy not found');

  return prisma.dbMaskingPolicy.update({
    where: { id: policyId },
    data,
  });
}

export async function deletePolicy(tenantId: string, policyId: string): Promise<void> {
  const existing = await prisma.dbMaskingPolicy.findFirst({ where: { id: policyId, tenantId } });
  if (!existing) throw new Error('Masking policy not found');

  await prisma.dbMaskingPolicy.delete({ where: { id: policyId } });
}
