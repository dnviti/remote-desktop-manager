import prisma, { FirewallAction, Prisma } from '../lib/prisma';
import { logger } from '../utils/logger';
import { compileRegex } from '../utils/safeRegex';

const log = logger.child('sql-firewall');

// ---- Types ----

export interface FirewallRuleInput {
  tenantId: string;
  name: string;
  pattern: string;
  action: FirewallAction;
  scope?: string;
  description?: string;
  enabled?: boolean;
  priority?: number;
}

export interface FirewallRule {
  id: string;
  tenantId: string;
  name: string;
  pattern: string;
  action: FirewallAction;
  scope: string | null;
  description: string | null;
  enabled: boolean;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface FirewallEvaluation {
  allowed: boolean;
  matchedRule: FirewallRule | null;
  action: FirewallAction | null;
}

// ---- Built-in patterns (always active, lowest priority) ----

const BUILTIN_DENY_PATTERNS = [
  { name: 'Drop Table', pattern: '\\bDROP\\s+TABLE\\b', action: 'BLOCK' as FirewallAction },
  { name: 'Truncate', pattern: '\\bTRUNCATE\\b', action: 'BLOCK' as FirewallAction },
  { name: 'Drop Database', pattern: '\\bDROP\\s+DATABASE\\b', action: 'BLOCK' as FirewallAction },
  { name: 'Bulk SELECT without WHERE', pattern: '^\\s*SELECT\\s+\\*\\s+FROM\\s+\\S+\\s*;?\\s*$', action: 'ALERT' as FirewallAction },
];

// ---- Evaluation ----

/**
 * Evaluate a SQL query against all active firewall rules for the tenant.
 * Returns the evaluation result including whether the query is allowed and
 * which rule matched (if any).
 *
 * Rules are evaluated in priority order (higher priority first).
 * If a BLOCK rule matches, the query is denied.
 * ALERT and LOG rules allow the query but trigger notifications.
 */
export async function evaluateQuery(
  tenantId: string,
  queryText: string,
  database?: string,
  table?: string,
): Promise<FirewallEvaluation> {
  try {
    // Fetch tenant-specific rules
    const rules = await prisma.dbFirewallRule.findMany({
      where: { tenantId, enabled: true },
      orderBy: { priority: 'desc' },
    });

    // Check tenant rules first (higher priority)
    for (const rule of rules) {
      if (matchesRule(rule, queryText, database, table)) {
        return {
          allowed: rule.action !== 'BLOCK',
          matchedRule: rule,
          action: rule.action,
        };
      }
    }

    // Check built-in patterns
    for (const builtin of BUILTIN_DENY_PATTERNS) {
      try {
        // eslint-disable-next-line security/detect-non-literal-regexp -- Built-in firewall patterns are compile-time constants defined in this module
        const regex = new RegExp(builtin.pattern, 'i');
        if (regex.test(queryText)) {
          const syntheticRule: FirewallRule = {
            id: `builtin:${builtin.name}`,
            tenantId,
            name: `[Built-in] ${builtin.name}`,
            pattern: builtin.pattern,
            action: builtin.action,
            scope: null,
            description: `Built-in firewall rule: ${builtin.name}`,
            enabled: true,
            priority: -1,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          return {
            allowed: builtin.action !== 'BLOCK',
            matchedRule: syntheticRule,
            action: builtin.action,
          };
        }
      } catch {
        // Skip invalid builtin regex (should never happen)
      }
    }
  } catch (err) {
    log.error('Firewall evaluation error — allowing query as fallback:', err instanceof Error ? err.message : 'Unknown error');
  }

  return { allowed: true, matchedRule: null, action: null };
}

function matchesRule(
  rule: { pattern: string; scope: string | null },
  queryText: string,
  database?: string,
  table?: string,
): boolean {
  // Check scope if specified
  if (rule.scope) {
    const scopeLower = rule.scope.toLowerCase();
    const dbMatch = database && database.toLowerCase() === scopeLower;
    const tableMatch = table && table.toLowerCase() === scopeLower;
    if (!dbMatch && !tableMatch) return false;
  }

  try {
    // eslint-disable-next-line security/detect-non-literal-regexp -- Dynamic pattern from admin-configured firewall rule stored in DB
    const regex = new RegExp(rule.pattern, 'i');
    return regex.test(queryText);
  } catch {
    log.warn(`Invalid regex in firewall rule: ${rule.pattern}`);
    return false;
  }
}

// ---- CRUD operations ----

export async function listRules(tenantId: string): Promise<FirewallRule[]> {
  return prisma.dbFirewallRule.findMany({
    where: { tenantId },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function getRule(tenantId: string, ruleId: string): Promise<FirewallRule | null> {
  return prisma.dbFirewallRule.findFirst({
    where: { id: ruleId, tenantId },
  });
}

export async function createRule(input: FirewallRuleInput): Promise<FirewallRule> {
  // Validate regex pattern (safety + syntax check)
  compileRegex(input.pattern, 'i', 'firewall rule');

  return prisma.dbFirewallRule.create({
    data: {
      tenantId: input.tenantId,
      name: input.name,
      pattern: input.pattern,
      action: input.action,
      scope: input.scope ?? null,
      description: input.description ?? null,
      enabled: input.enabled ?? true,
      priority: input.priority ?? 0,
    },
  });
}

export async function updateRule(
  tenantId: string,
  ruleId: string,
  updates: Partial<Omit<FirewallRuleInput, 'tenantId'>>,
): Promise<FirewallRule> {
  // Validate regex pattern if provided (safety + syntax check)
  if (updates.pattern) {
    compileRegex(updates.pattern, 'i', 'firewall rule');
  }

  const data: Prisma.DbFirewallRuleUpdateInput = {};
  if (updates.name !== undefined) data.name = updates.name;
  if (updates.pattern !== undefined) data.pattern = updates.pattern;
  if (updates.action !== undefined) data.action = updates.action;
  if (updates.scope !== undefined) data.scope = updates.scope ?? null;
  if (updates.description !== undefined) data.description = updates.description ?? null;
  if (updates.enabled !== undefined) data.enabled = updates.enabled;
  if (updates.priority !== undefined) data.priority = updates.priority;

  // Ensure the rule belongs to this tenant
  const existing = await prisma.dbFirewallRule.findFirst({ where: { id: ruleId, tenantId } });
  if (!existing) throw new Error('Firewall rule not found');

  return prisma.dbFirewallRule.update({
    where: { id: ruleId },
    data,
  });
}

export async function deleteRule(tenantId: string, ruleId: string): Promise<void> {
  const existing = await prisma.dbFirewallRule.findFirst({ where: { id: ruleId, tenantId } });
  if (!existing) throw new Error('Firewall rule not found');

  await prisma.dbFirewallRule.delete({ where: { id: ruleId } });
}
