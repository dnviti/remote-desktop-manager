import prisma from '../lib/prisma';
import type { KeystrokePolicyAction } from '../lib/prisma';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KeystrokePolicyData {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  action: KeystrokePolicyAction;
  regexPatterns: string[];
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PolicyMatch {
  policyId: string;
  policyName: string;
  action: KeystrokePolicyAction;
  matchedPattern: string;
  matchedInput: string;
}

// ---------------------------------------------------------------------------
// Regex safety: reject patterns with nested quantifiers that cause catastrophic
// backtracking (ReDoS). This is a heuristic check — not a full formal analysis.
// ---------------------------------------------------------------------------

const NESTED_QUANTIFIER_RE = /(\+|\*|\{)\s*\)(\+|\*|\?|\{)/;

/**
 * Returns true if the regex pattern is considered safe from ReDoS.
 * Rejects patterns with nested quantifiers (e.g., (a+)+, (.*)*).
 */
export function isRegexSafe(pattern: string): boolean {
  if (NESTED_QUANTIFIER_RE.test(pattern)) return false;
  // Reject patterns longer than the configured max
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) return false;
  return true;
}

/** Maximum length for a single regex pattern string. */
export const MAX_REGEX_PATTERN_LENGTH = 500;
/** Maximum number of regex patterns per policy. */
export const MAX_PATTERNS_PER_POLICY = 50;
/** Maximum number of cached tenants before eviction of oldest entries. */
const MAX_CACHE_ENTRIES = 500;

// ---------------------------------------------------------------------------
// In-memory policy cache per tenant (refreshed every 30 seconds)
// ---------------------------------------------------------------------------

interface CachedPolicies {
  policies: CompiledPolicy[];
  fetchedAt: number;
}

interface CompiledPolicy {
  id: string;
  name: string;
  action: KeystrokePolicyAction;
  patterns: { source: string; regex: RegExp }[];
}

const policyCache = new Map<string, CachedPolicies>();
const CACHE_TTL_MS = 30_000;

/** Evict oldest entries when the cache exceeds MAX_CACHE_ENTRIES. */
function evictStaleCache(): void {
  if (policyCache.size <= MAX_CACHE_ENTRIES) return;
  // Map iteration order is insertion order; delete the oldest entries
  const excess = policyCache.size - MAX_CACHE_ENTRIES;
  let removed = 0;
  for (const key of policyCache.keys()) {
    if (removed >= excess) break;
    policyCache.delete(key);
    removed++;
  }
}

async function getCompiledPolicies(tenantId: string): Promise<CompiledPolicy[]> {
  const cached = policyCache.get(tenantId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.policies;
  }

  const rows = await prisma.keystrokePolicy.findMany({
    where: { tenantId, enabled: true },
    select: { id: true, name: true, action: true, regexPatterns: true },
  });

  const compiled: CompiledPolicy[] = [];
  for (const row of rows) {
    const patterns: { source: string; regex: RegExp }[] = [];
    for (const src of row.regexPatterns) {
      try {
        if (!isRegexSafe(src)) {
          logger.warn(`Skipping unsafe regex in keystroke policy ${row.id}: pattern rejected by safety check`);
          continue;
        }
        patterns.push({ source: src, regex: new RegExp(src, 'i') });
      } catch {
        logger.warn(`Invalid regex in keystroke policy ${row.id}: pattern failed to compile`);
      }
    }
    if (patterns.length > 0) {
      compiled.push({
        id: row.id,
        name: row.name,
        action: row.action as KeystrokePolicyAction,
        patterns,
      });
    }
  }

  policyCache.set(tenantId, { policies: compiled, fetchedAt: Date.now() });
  evictStaleCache();
  return compiled;
}

/** Force-refresh the cache for a tenant (e.g. after CRUD operations). */
export function invalidateCache(tenantId: string): void {
  policyCache.delete(tenantId);
}

// ---------------------------------------------------------------------------
// Real-time keystroke buffer: reconstructs the logical input line
// ---------------------------------------------------------------------------

/**
 * Maintains a per-session buffer that reconstructs the user's current input
 * line from raw terminal data, handling control characters such as:
 * - Backspace (0x7F, 0x08)
 * - Ctrl-U (kill line)
 * - Ctrl-C / Ctrl-D (reset line)
 * - Enter / newline (submit line, reset buffer)
 */
export class KeystrokeBuffer {
  private buffer = '';
  private _sawNewline = false;

  /**
   * Feed raw terminal data into the buffer and return the current logical line.
   * Also tracks whether a newline was seen — check via `sawNewline()`.
   */
  feed(data: string): string {
    this._sawNewline = false;

    for (const ch of data) {
      const code = ch.charCodeAt(0);

      if (code === 0x0D || code === 0x0A) {
        // Enter / newline: line submitted — reset after caller inspects
        // We keep the buffer as-is so caller can read it, then call reset()
        this._sawNewline = true;
        continue;
      }

      if (code === 0x7F || code === 0x08) {
        // Backspace
        this.buffer = this.buffer.slice(0, -1);
        continue;
      }

      if (code === 0x15) {
        // Ctrl-U: kill line
        this.buffer = '';
        continue;
      }

      if (code === 0x03 || code === 0x04) {
        // Ctrl-C / Ctrl-D: reset
        this.buffer = '';
        continue;
      }

      // Ignore other control characters (below 0x20 except tab)
      if (code < 0x20 && code !== 0x09) {
        continue;
      }

      this.buffer += ch;
    }

    return this.buffer;
  }

  /** Return the current logical line without modifying state. */
  current(): string {
    return this.buffer;
  }

  /**
   * Returns true if the most recent `feed()` call encountered a newline.
   * This avoids a separate scan of the data string.
   */
  sawNewline(): boolean {
    return this._sawNewline;
  }

  /** @deprecated Use `sawNewline()` instead — avoids re-scanning the data. */
  hasNewline(data: string): boolean {
    return data.includes('\r') || data.includes('\n');
  }

  /** Reset the buffer (call after a newline is detected and inspection is done). */
  reset(): void {
    this.buffer = '';
  }
}

// ---------------------------------------------------------------------------
// Inspection: check the current input against compiled policies
// ---------------------------------------------------------------------------

/** Maximum length of matched input stored in audit logs / notifications. */
const MAX_MATCHED_INPUT_LOG_LENGTH = 80;

/**
 * Truncate and partially redact user input for safe logging.
 * Shows the first N characters, with a truncation marker if needed.
 * This avoids logging full commands that may contain inline passwords or secrets.
 */
function redactForLog(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length <= MAX_MATCHED_INPUT_LOG_LENGTH) return trimmed;
  return trimmed.slice(0, MAX_MATCHED_INPUT_LOG_LENGTH) + '...[truncated]';
}

export async function inspect(
  tenantId: string,
  input: string,
): Promise<PolicyMatch | null> {
  if (!input.trim()) return null;

  const policies = await getCompiledPolicies(tenantId);
  for (const policy of policies) {
    for (const { source, regex } of policy.patterns) {
      if (regex.test(input)) {
        return {
          policyId: policy.id,
          policyName: policy.name,
          action: policy.action,
          matchedPattern: source,
          matchedInput: redactForLog(input),
        };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

export async function listPolicies(tenantId: string): Promise<KeystrokePolicyData[]> {
  return prisma.keystrokePolicy.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
  }) as Promise<KeystrokePolicyData[]>;
}

export async function getPolicy(
  tenantId: string,
  policyId: string,
): Promise<KeystrokePolicyData> {
  const policy = await prisma.keystrokePolicy.findFirst({
    where: { id: policyId, tenantId },
  });
  if (!policy) {
    const err = new Error('Keystroke policy not found') as Error & { statusCode: number };
    err.statusCode = 404;
    throw err;
  }
  return policy as KeystrokePolicyData;
}

export async function createPolicy(
  tenantId: string,
  data: {
    name: string;
    description?: string | null;
    action: KeystrokePolicyAction;
    regexPatterns: string[];
    enabled?: boolean;
  },
): Promise<KeystrokePolicyData> {
  if (data.regexPatterns.length > MAX_PATTERNS_PER_POLICY) {
    const err = new Error(`Too many regex patterns (max ${MAX_PATTERNS_PER_POLICY})`) as Error & { statusCode: number };
    err.statusCode = 400;
    throw err;
  }

  // Validate regex patterns at creation time
  for (let i = 0; i < data.regexPatterns.length; i++) {
    const pattern = data.regexPatterns[i];
    if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
      const err = new Error(`Regex pattern at index ${i} exceeds maximum length of ${MAX_REGEX_PATTERN_LENGTH} characters`) as Error & { statusCode: number };
      err.statusCode = 400;
      throw err;
    }
    if (!isRegexSafe(pattern)) {
      const err = new Error(`Regex pattern at index ${i} was rejected by the safety check (possible ReDoS)`) as Error & { statusCode: number };
      err.statusCode = 400;
      throw err;
    }
    try {
      new RegExp(pattern);
    } catch {
      const err = new Error(`Invalid regex pattern at index ${i}`) as Error & { statusCode: number };
      err.statusCode = 400;
      throw err;
    }
  }

  const policy = await prisma.keystrokePolicy.create({
    data: {
      tenantId,
      name: data.name,
      description: data.description ?? null,
      action: data.action,
      regexPatterns: data.regexPatterns,
      enabled: data.enabled ?? true,
    },
  });

  invalidateCache(tenantId);
  return policy as KeystrokePolicyData;
}

export async function updatePolicy(
  tenantId: string,
  policyId: string,
  data: {
    name?: string;
    description?: string | null;
    action?: KeystrokePolicyAction;
    regexPatterns?: string[];
    enabled?: boolean;
  },
): Promise<KeystrokePolicyData> {
  const existing = await prisma.keystrokePolicy.findFirst({
    where: { id: policyId, tenantId },
  });
  if (!existing) {
    const err = new Error('Keystroke policy not found') as Error & { statusCode: number };
    err.statusCode = 404;
    throw err;
  }

  if (data.regexPatterns) {
    if (data.regexPatterns.length > MAX_PATTERNS_PER_POLICY) {
      const err = new Error(`Too many regex patterns (max ${MAX_PATTERNS_PER_POLICY})`) as Error & { statusCode: number };
      err.statusCode = 400;
      throw err;
    }
    for (let i = 0; i < data.regexPatterns.length; i++) {
      const pattern = data.regexPatterns[i];
      if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
        const err = new Error(`Regex pattern at index ${i} exceeds maximum length of ${MAX_REGEX_PATTERN_LENGTH} characters`) as Error & { statusCode: number };
        err.statusCode = 400;
        throw err;
      }
      if (!isRegexSafe(pattern)) {
        const err = new Error(`Regex pattern at index ${i} was rejected by the safety check (possible ReDoS)`) as Error & { statusCode: number };
        err.statusCode = 400;
        throw err;
      }
      try {
        new RegExp(pattern);
      } catch {
        const err = new Error(`Invalid regex pattern at index ${i}`) as Error & { statusCode: number };
        err.statusCode = 400;
        throw err;
      }
    }
  }

  const policy = await prisma.keystrokePolicy.update({
    where: { id: policyId },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.action !== undefined && { action: data.action }),
      ...(data.regexPatterns !== undefined && { regexPatterns: data.regexPatterns }),
      ...(data.enabled !== undefined && { enabled: data.enabled }),
    },
  });

  invalidateCache(tenantId);
  return policy as KeystrokePolicyData;
}

export async function deletePolicy(
  tenantId: string,
  policyId: string,
): Promise<void> {
  const existing = await prisma.keystrokePolicy.findFirst({
    where: { id: policyId, tenantId },
  });
  if (!existing) {
    const err = new Error('Keystroke policy not found') as Error & { statusCode: number };
    err.statusCode = 404;
    throw err;
  }

  await prisma.keystrokePolicy.delete({ where: { id: policyId } });
  invalidateCache(tenantId);
}
