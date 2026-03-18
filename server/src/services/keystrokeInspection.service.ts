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
        patterns.push({ source: src, regex: new RegExp(src, 'i') });
      } catch {
        logger.warn(`Invalid regex in keystroke policy ${row.id}: ${src}`);
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

  /** Feed raw terminal data into the buffer and return the current logical line. */
  feed(data: string): string {
    for (const ch of data) {
      const code = ch.charCodeAt(0);

      if (code === 0x0D || code === 0x0A) {
        // Enter / newline: line submitted — reset after caller inspects
        // We keep the buffer as-is so caller can read it, then call reset()
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

  /** Check if a newline/enter was present in the data. */
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
          matchedInput: input,
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
  // Validate regex patterns at creation time
  for (const pattern of data.regexPatterns) {
    try {
      new RegExp(pattern);
    } catch {
      const err = new Error(`Invalid regex pattern: ${pattern}`) as Error & { statusCode: number };
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
    for (const pattern of data.regexPatterns) {
      try {
        new RegExp(pattern);
      } catch {
        const err = new Error(`Invalid regex pattern: ${pattern}`) as Error & { statusCode: number };
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
