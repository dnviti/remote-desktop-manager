import { Response } from 'express';
import { AuthRequest, assertTenantAuthenticated } from '../types';
import * as dbAuditService from '../services/dbAudit.service';
import * as sqlFirewallService from '../services/sqlFirewall.service';
import * as dataMaskingService from '../services/dataMasking.service';
import * as dbRateLimitService from '../services/dbRateLimit.service';
import * as auditService from '../services/audit.service';
import { AppError } from '../middleware/error.middleware';
import { getClientIp } from '../utils/ip';
import { DbQueryType, FirewallAction, MaskingStrategy, RateLimitAction } from '../lib/prisma';

// ---- DB Audit Logs ----

export async function listDbAuditLogs(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);

  const query: dbAuditService.DbAuditLogQuery = {
    tenantId: req.user.tenantId,
    page: req.query.page ? Number(req.query.page) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    userId: req.query.userId as string | undefined,
    connectionId: req.query.connectionId as string | undefined,
    queryType: req.query.queryType as DbQueryType | undefined,
    blocked: req.query.blocked !== undefined ? req.query.blocked === 'true' : undefined,
    search: req.query.search as string | undefined,
    startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
    endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
    sortBy: req.query.sortBy as 'createdAt' | 'queryType' | 'executionTimeMs' | undefined,
    sortOrder: req.query.sortOrder as 'asc' | 'desc' | undefined,
  };

  const result = await dbAuditService.getDbAuditLogs(query);
  res.json(result);
}

export async function listDbAuditConnections(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const connections = await dbAuditService.getDbAuditConnections(req.user.tenantId);
  res.json(connections);
}

export async function listDbAuditUsers(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const users = await dbAuditService.getDbAuditUsers(req.user.tenantId);
  res.json(users);
}

// ---- Firewall Rules ----

export async function listFirewallRules(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const rules = await sqlFirewallService.listRules(req.user.tenantId);
  res.json(rules);
}

export async function getFirewallRule(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const ruleId = req.params.ruleId as string;
  const rule = await sqlFirewallService.getRule(req.user.tenantId, ruleId);
  if (!rule) throw new AppError('Firewall rule not found', 404);
  res.json(rule);
}

export async function createFirewallRule(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);

  const { name, pattern, action, scope, description, enabled, priority } = req.body as {
    name: string;
    pattern: string;
    action: FirewallAction;
    scope?: string;
    description?: string;
    enabled?: boolean;
    priority?: number;
  };

  if (!name || !pattern || !action) {
    throw new AppError('name, pattern, and action are required', 400);
  }

  const rule = await sqlFirewallService.createRule({
    tenantId: req.user.tenantId,
    name,
    pattern,
    action,
    scope,
    description,
    enabled,
    priority,
  });

  const ip = getClientIp(req);
  auditService.log({
    userId: req.user.userId,
    action: 'DB_FIREWALL_RULE_CREATE',
    targetType: 'DbFirewallRule',
    targetId: rule.id,
    details: { name, pattern, firewallAction: action },
    ipAddress: ip,
  });

  res.status(201).json(rule);
}

export async function updateFirewallRule(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const ruleId = req.params.ruleId as string;

  const { name, pattern, action, scope, description, enabled, priority } = req.body as {
    name?: string;
    pattern?: string;
    action?: FirewallAction;
    scope?: string;
    description?: string;
    enabled?: boolean;
    priority?: number;
  };

  const rule = await sqlFirewallService.updateRule(
    req.user.tenantId,
    ruleId,
    { name, pattern, action, scope, description, enabled, priority },
  );

  const ip = getClientIp(req);
  auditService.log({
    userId: req.user.userId,
    action: 'DB_FIREWALL_RULE_UPDATE',
    targetType: 'DbFirewallRule',
    targetId: rule.id,
    details: { name: rule.name },
    ipAddress: ip,
  });

  res.json(rule);
}

export async function deleteFirewallRule(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const ruleId = req.params.ruleId as string;

  await sqlFirewallService.deleteRule(req.user.tenantId, ruleId);

  const ip = getClientIp(req);
  auditService.log({
    userId: req.user.userId,
    action: 'DB_FIREWALL_RULE_DELETE',
    targetType: 'DbFirewallRule',
    targetId: ruleId,
    ipAddress: ip,
  });

  res.json({ ok: true });
}

// ---- Masking Policies ----

export async function listMaskingPolicies(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const policies = await dataMaskingService.listPolicies(req.user.tenantId);
  res.json(policies);
}

export async function getMaskingPolicy(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const policyId = req.params.policyId as string;
  const policy = await dataMaskingService.getPolicy(req.user.tenantId, policyId);
  if (!policy) throw new AppError('Masking policy not found', 404);
  res.json(policy);
}

export async function createMaskingPolicy(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);

  const { name, columnPattern, strategy, exemptRoles, scope, description, enabled } = req.body as {
    name: string;
    columnPattern: string;
    strategy: MaskingStrategy;
    exemptRoles?: string[];
    scope?: string;
    description?: string;
    enabled?: boolean;
  };

  if (!name || !columnPattern || !strategy) {
    throw new AppError('name, columnPattern, and strategy are required', 400);
  }

  const policy = await dataMaskingService.createPolicy({
    tenantId: req.user.tenantId,
    name,
    columnPattern,
    strategy,
    exemptRoles,
    scope,
    description,
    enabled,
  });

  const ip = getClientIp(req);
  auditService.log({
    userId: req.user.userId,
    action: 'DB_MASKING_POLICY_CREATE',
    targetType: 'DbMaskingPolicy',
    targetId: policy.id,
    details: { name, strategy },
    ipAddress: ip,
  });

  res.status(201).json(policy);
}

export async function updateMaskingPolicy(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const policyId = req.params.policyId as string;

  const { name, columnPattern, strategy, exemptRoles, scope, description, enabled } = req.body as {
    name?: string;
    columnPattern?: string;
    strategy?: MaskingStrategy;
    exemptRoles?: string[];
    scope?: string;
    description?: string;
    enabled?: boolean;
  };

  const policy = await dataMaskingService.updatePolicy(
    req.user.tenantId,
    policyId,
    { name, columnPattern, strategy, exemptRoles, scope, description, enabled },
  );

  const ip = getClientIp(req);
  auditService.log({
    userId: req.user.userId,
    action: 'DB_MASKING_POLICY_UPDATE',
    targetType: 'DbMaskingPolicy',
    targetId: policy.id,
    details: { name: policy.name },
    ipAddress: ip,
  });

  res.json(policy);
}

export async function deleteMaskingPolicy(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const policyId = req.params.policyId as string;

  await dataMaskingService.deletePolicy(req.user.tenantId, policyId);

  const ip = getClientIp(req);
  auditService.log({
    userId: req.user.userId,
    action: 'DB_MASKING_POLICY_DELETE',
    targetType: 'DbMaskingPolicy',
    targetId: policyId,
    ipAddress: ip,
  });

  res.json({ ok: true });
}

// ---- Rate Limit Policies ----

export async function listRateLimitPolicies(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const policies = await dbRateLimitService.listPolicies(req.user.tenantId);
  res.json(policies);
}

export async function getRateLimitPolicy(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const policyId = req.params.policyId as string;
  const policy = await dbRateLimitService.getPolicy(req.user.tenantId, policyId);
  if (!policy) throw new AppError('Rate limit policy not found', 404);
  res.json(policy);
}

export async function createRateLimitPolicy(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);

  const { name, queryType, windowMs, maxQueries, burstMax, exemptRoles, scope, action, enabled, priority } = req.body as {
    name: string;
    queryType?: DbQueryType | null;
    windowMs?: number;
    maxQueries?: number;
    burstMax?: number;
    exemptRoles?: string[];
    scope?: string;
    action?: RateLimitAction;
    enabled?: boolean;
    priority?: number;
  };

  if (!name) {
    throw new AppError('name is required', 400);
  }

  const policy = await dbRateLimitService.createPolicy({
    tenantId: req.user.tenantId,
    name,
    queryType,
    windowMs,
    maxQueries,
    burstMax,
    exemptRoles,
    scope,
    action,
    enabled,
    priority,
  });

  const ip = getClientIp(req);
  auditService.log({
    userId: req.user.userId,
    action: 'DB_RATE_LIMIT_POLICY_CREATE',
    targetType: 'DbRateLimitPolicy',
    targetId: policy.id,
    details: { name, queryType: queryType ?? 'ALL', rateLimitAction: action ?? 'REJECT' },
    ipAddress: ip,
  });

  res.status(201).json(policy);
}

export async function updateRateLimitPolicy(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const policyId = req.params.policyId as string;

  const { name, queryType, windowMs, maxQueries, burstMax, exemptRoles, scope, action, enabled, priority } = req.body as {
    name?: string;
    queryType?: DbQueryType | null;
    windowMs?: number;
    maxQueries?: number;
    burstMax?: number;
    exemptRoles?: string[];
    scope?: string;
    action?: RateLimitAction;
    enabled?: boolean;
    priority?: number;
  };

  const policy = await dbRateLimitService.updatePolicy(
    req.user.tenantId,
    policyId,
    { name, queryType, windowMs, maxQueries, burstMax, exemptRoles, scope, action, enabled, priority },
  );

  const ip = getClientIp(req);
  auditService.log({
    userId: req.user.userId,
    action: 'DB_RATE_LIMIT_POLICY_UPDATE',
    targetType: 'DbRateLimitPolicy',
    targetId: policy.id,
    details: { name: policy.name },
    ipAddress: ip,
  });

  res.json(policy);
}

export async function deleteRateLimitPolicy(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const policyId = req.params.policyId as string;

  await dbRateLimitService.deletePolicy(req.user.tenantId, policyId);

  const ip = getClientIp(req);
  auditService.log({
    userId: req.user.userId,
    action: 'DB_RATE_LIMIT_POLICY_DELETE',
    targetType: 'DbRateLimitPolicy',
    targetId: policyId,
    ipAddress: ip,
  });

  res.json({ ok: true });
}
