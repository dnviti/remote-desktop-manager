import prisma, { DbQueryType, RateLimitAction, Prisma } from '../lib/prisma';
import { config } from '../config';
import { logger } from '../utils/logger';

const log = logger.child('db-rate-limit');

// ---- Types ----

export interface RateLimitPolicyInput {
  tenantId: string;
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
  createdAt: Date;
  updatedAt: Date;
}

export interface RateLimitEvaluation {
  allowed: boolean;
  policy: RateLimitPolicy | null;
  remaining: number;
  retryAfterMs: number;
}

// ---- Token bucket implementation ----

interface TokenBucket {
  tokens: number;
  lastRefillTime: number;
  windowMs: number;
  maxTokens: number;
  refillRate: number; // tokens per ms
}

/**
 * In-memory token bucket map.
 * Key format: `userId:tenantId:queryType:policyId`
 */
const buckets = new Map<string, TokenBucket>();

/**
 * Cleanup interval handle — used to periodically sweep expired buckets.
 */
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function getBucketKey(userId: string, tenantId: string, queryType: string, policyId: string): string {
  return `${userId}:${tenantId}:${queryType}:${policyId}`;
}

function getOrCreateBucket(key: string, policy: RateLimitPolicy): TokenBucket {
  const existing = buckets.get(key);
  if (existing) {
    // Refill tokens based on elapsed time
    const now = Date.now();
    const elapsed = now - existing.lastRefillTime;
    const refillAmount = elapsed * existing.refillRate;
    existing.tokens = Math.min(existing.maxTokens, existing.tokens + refillAmount);
    existing.lastRefillTime = now;
    return existing;
  }

  const bucket: TokenBucket = {
    tokens: policy.burstMax,
    lastRefillTime: Date.now(),
    windowMs: policy.windowMs,
    maxTokens: policy.burstMax,
    refillRate: policy.maxQueries / policy.windowMs,
  };
  buckets.set(key, bucket);
  return bucket;
}

function consumeToken(bucket: TokenBucket): boolean {
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return true;
  }
  return false;
}

function calculateRetryAfterMs(bucket: TokenBucket): number {
  if (bucket.tokens >= 1) return 0;
  // Time until 1 token is available
  const tokensNeeded = 1 - bucket.tokens;
  return Math.ceil(tokensNeeded / bucket.refillRate);
}

// ---- Periodic cleanup ----

function cleanupExpiredBuckets(): void {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    // Remove buckets that haven't been used for 2x the window duration
    const idleTime = now - bucket.lastRefillTime;
    if (idleTime > bucket.windowMs * 2) {
      buckets.delete(key);
    }
  }
}

/** Start the periodic cleanup timer (idempotent). */
export function startCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(cleanupExpiredBuckets, config.dbRateLimitCleanupIntervalMs);
  // Ensure the timer doesn't prevent Node from exiting
  if (cleanupTimer && typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
    cleanupTimer.unref();
  }
}

/** Stop the periodic cleanup timer. */
export function stopCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

// Auto-start cleanup on module load
startCleanup();

// ---- Evaluation ----

/**
 * Evaluate rate limits for a query.
 * Returns the evaluation result indicating whether the query is allowed
 * and which policy matched (if any).
 *
 * Policies are evaluated in priority order (higher priority first).
 * Only the first matching policy is applied.
 */
export async function evaluateRateLimit(
  userId: string,
  tenantId: string,
  queryType: DbQueryType,
  tenantRole?: string,
): Promise<RateLimitEvaluation> {
  try {
    const policies = await prisma.dbRateLimitPolicy.findMany({
      where: { tenantId, enabled: true },
      orderBy: { priority: 'desc' },
    });

    for (const policy of policies) {
      // Check if policy applies to this query type
      if (policy.queryType !== null && policy.queryType !== queryType) {
        continue;
      }

      // Check role exemptions
      if (tenantRole && policy.exemptRoles.length > 0) {
        if (policy.exemptRoles.includes(tenantRole)) {
          continue;
        }
      }

      // Found a matching policy — evaluate token bucket
      const bucketKey = getBucketKey(userId, tenantId, policy.queryType ?? 'ALL', policy.id);
      const bucket = getOrCreateBucket(bucketKey, policy);
      const consumed = consumeToken(bucket);

      if (!consumed) {
        const retryAfterMs = calculateRetryAfterMs(bucket);
        return {
          allowed: policy.action === 'LOG_ONLY',
          policy,
          remaining: Math.max(0, Math.floor(bucket.tokens)),
          retryAfterMs,
        };
      }

      return {
        allowed: true,
        policy,
        remaining: Math.max(0, Math.floor(bucket.tokens)),
        retryAfterMs: 0,
      };
    }
  } catch (err) {
    log.error('Rate limit evaluation error — allowing query as fallback:', err instanceof Error ? err.message : 'Unknown error');
  }

  return { allowed: true, policy: null, remaining: -1, retryAfterMs: 0 };
}

// ---- CRUD operations ----

export async function listPolicies(tenantId: string): Promise<RateLimitPolicy[]> {
  return prisma.dbRateLimitPolicy.findMany({
    where: { tenantId },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function getPolicy(tenantId: string, policyId: string): Promise<RateLimitPolicy | null> {
  return prisma.dbRateLimitPolicy.findFirst({
    where: { id: policyId, tenantId },
  });
}

export async function createPolicy(input: RateLimitPolicyInput): Promise<RateLimitPolicy> {
  return prisma.dbRateLimitPolicy.create({
    data: {
      tenantId: input.tenantId,
      name: input.name,
      queryType: input.queryType ?? null,
      windowMs: input.windowMs ?? config.dbRateLimitDefaultWindowMs,
      maxQueries: input.maxQueries ?? config.dbRateLimitDefaultMaxQueries,
      burstMax: input.burstMax ?? 10,
      exemptRoles: input.exemptRoles ?? [],
      scope: input.scope ?? null,
      action: input.action ?? 'REJECT',
      enabled: input.enabled ?? true,
      priority: input.priority ?? 0,
    },
  });
}

export async function updatePolicy(
  tenantId: string,
  policyId: string,
  updates: Partial<Omit<RateLimitPolicyInput, 'tenantId'>>,
): Promise<RateLimitPolicy> {
  const existing = await prisma.dbRateLimitPolicy.findFirst({ where: { id: policyId, tenantId } });
  if (!existing) throw new Error('Rate limit policy not found');

  const data: Prisma.DbRateLimitPolicyUpdateInput = {};
  if (updates.name !== undefined) data.name = updates.name;
  if (updates.queryType !== undefined) data.queryType = updates.queryType ?? null;
  if (updates.windowMs !== undefined) data.windowMs = updates.windowMs;
  if (updates.maxQueries !== undefined) data.maxQueries = updates.maxQueries;
  if (updates.burstMax !== undefined) data.burstMax = updates.burstMax;
  if (updates.exemptRoles !== undefined) data.exemptRoles = updates.exemptRoles ?? [];
  if (updates.scope !== undefined) data.scope = updates.scope ?? null;
  if (updates.action !== undefined) data.action = updates.action;
  if (updates.enabled !== undefined) data.enabled = updates.enabled;
  if (updates.priority !== undefined) data.priority = updates.priority;

  return prisma.dbRateLimitPolicy.update({
    where: { id: policyId },
    data,
  });
}

export async function deletePolicy(tenantId: string, policyId: string): Promise<void> {
  const existing = await prisma.dbRateLimitPolicy.findFirst({ where: { id: policyId, tenantId } });
  if (!existing) throw new Error('Rate limit policy not found');

  await prisma.dbRateLimitPolicy.delete({ where: { id: policyId } });
}
