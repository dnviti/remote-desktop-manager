import api from './client';

export type DbQueryType = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'DDL' | 'OTHER';
export type FirewallAction = 'BLOCK' | 'ALERT' | 'LOG';
export type MaskingStrategy = 'REDACT' | 'HASH' | 'PARTIAL';

// ---- DB Audit Logs ----

export interface DbAuditLogEntry {
  id: string;
  userId: string;
  connectionId: string;
  tenantId: string | null;
  queryText: string;
  queryType: DbQueryType;
  tablesAccessed: string[];
  rowsAffected: number | null;
  executionTimeMs: number | null;
  blocked: boolean;
  blockReason: string | null;
  createdAt: string;
  userName: string | null;
  userEmail: string | null;
  connectionName: string | null;
}

export interface DbAuditLogResponse {
  data: DbAuditLogEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface DbAuditLogParams {
  page?: number;
  limit?: number;
  userId?: string;
  connectionId?: string;
  queryType?: DbQueryType;
  blocked?: boolean;
  search?: string;
  startDate?: string;
  endDate?: string;
  sortBy?: 'createdAt' | 'queryType' | 'executionTimeMs';
  sortOrder?: 'asc' | 'desc';
}

export interface DbAuditConnection {
  id: string;
  name: string;
}

export interface DbAuditUser {
  id: string;
  username: string | null;
  email: string;
}

export async function getDbAuditLogs(params: DbAuditLogParams = {}): Promise<DbAuditLogResponse> {
  const { data } = await api.get('/db-audit/logs', { params });
  return data;
}

export async function getDbAuditConnections(): Promise<DbAuditConnection[]> {
  const { data } = await api.get('/db-audit/logs/connections');
  return data;
}

export async function getDbAuditUsers(): Promise<DbAuditUser[]> {
  const { data } = await api.get('/db-audit/logs/users');
  return data;
}

// ---- Firewall Rules ----

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
  createdAt: string;
  updatedAt: string;
}

export interface FirewallRuleInput {
  name: string;
  pattern: string;
  action: FirewallAction;
  scope?: string;
  description?: string;
  enabled?: boolean;
  priority?: number;
}

export async function getFirewallRules(): Promise<FirewallRule[]> {
  const { data } = await api.get('/db-audit/firewall-rules');
  return data;
}

export async function createFirewallRule(input: FirewallRuleInput): Promise<FirewallRule> {
  const { data } = await api.post('/db-audit/firewall-rules', input);
  return data;
}

export async function updateFirewallRule(ruleId: string, input: Partial<FirewallRuleInput>): Promise<FirewallRule> {
  const { data } = await api.put(`/db-audit/firewall-rules/${ruleId}`, input);
  return data;
}

export async function deleteFirewallRule(ruleId: string): Promise<void> {
  await api.delete(`/db-audit/firewall-rules/${ruleId}`);
}

// ---- Masking Policies ----

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
  createdAt: string;
  updatedAt: string;
}

export interface MaskingPolicyInput {
  name: string;
  columnPattern: string;
  strategy: MaskingStrategy;
  exemptRoles?: string[];
  scope?: string;
  description?: string;
  enabled?: boolean;
}

export async function getMaskingPolicies(): Promise<MaskingPolicy[]> {
  const { data } = await api.get('/db-audit/masking-policies');
  return data;
}

export async function createMaskingPolicy(input: MaskingPolicyInput): Promise<MaskingPolicy> {
  const { data } = await api.post('/db-audit/masking-policies', input);
  return data;
}

export async function updateMaskingPolicy(policyId: string, input: Partial<MaskingPolicyInput>): Promise<MaskingPolicy> {
  const { data } = await api.put(`/db-audit/masking-policies/${policyId}`, input);
  return data;
}

export async function deleteMaskingPolicy(policyId: string): Promise<void> {
  await api.delete(`/db-audit/masking-policies/${policyId}`);
}

// ---- Rate Limit Policies ----

export type RateLimitAction = 'REJECT' | 'LOG_ONLY';

export interface RateLimitPolicy {
  id: string;
  tenantId: string;
  name: string;
  queryType: DbQueryType | null;
  windowMs: number;
  maxQueries: number;
  burstMax: number;
  exemptRoles: string[];
  scope: string | null;
  action: RateLimitAction;
  enabled: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface RateLimitPolicyInput {
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
}

export async function getRateLimitPolicies(): Promise<RateLimitPolicy[]> {
  const { data } = await api.get('/db-audit/rate-limit-policies');
  return data;
}

export async function createRateLimitPolicy(input: RateLimitPolicyInput): Promise<RateLimitPolicy> {
  const { data } = await api.post('/db-audit/rate-limit-policies', input);
  return data;
}

export async function updateRateLimitPolicy(policyId: string, input: Partial<RateLimitPolicyInput>): Promise<RateLimitPolicy> {
  const { data } = await api.put(`/db-audit/rate-limit-policies/${policyId}`, input);
  return data;
}

export async function deleteRateLimitPolicy(policyId: string): Promise<void> {
  await api.delete(`/db-audit/rate-limit-policies/${policyId}`);
}
