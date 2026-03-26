import rateLimit, { type Options, type Store, type IncrementResponse, ipKeyGenerator } from 'express-rate-limit';
import * as cache from '../utils/cacheClient';
import { config } from '../config';

interface RateLimitOpts {
  windowMs: number;
  max: number;
  message: string;
  /** If provided, keys rate limit by authenticated userId with this prefix (falls back to IP). */
  keyPrefix?: string;
  /** Extra options passed through to express-rate-limit. */
  extra?: Partial<Options>;
}

/**
 * Distributed rate limit store backed by gocache.
 *
 * Uses fixed-window counters with timestamp-bucketed keys so that
 * rate limits are shared across all server instances.
 */
class GoCacheRateLimitStore implements Store {
  readonly localKeys = false;

  constructor(private windowMs: number) {}

  async increment(key: string): Promise<IncrementResponse> {
    const windowStart = Math.floor(Date.now() / this.windowMs) * this.windowMs;
    const cacheKey = `rl:${key}:${windowStart}`;
    // Atomic increment — no separate TTL set needed.
    // Keys are timestamp-bucketed so stale windows are naturally ignored.
    // The sidecar's background sweeper / LRU eviction handles cleanup.
    const count = await cache.incr(cacheKey, 1);

    return {
      totalHits: count ?? 1,
      resetTime: new Date(windowStart + this.windowMs),
    };
  }

  async decrement(key: string): Promise<void> {
    const windowStart = Math.floor(Date.now() / this.windowMs) * this.windowMs;
    const cacheKey = `rl:${key}:${windowStart}`;
    await cache.incr(cacheKey, -1);
  }

  async resetKey(key: string): Promise<void> {
    const windowStart = Math.floor(Date.now() / this.windowMs) * this.windowMs;
    await cache.del(`rl:${key}:${windowStart}`);
  }
}

/** Create a rate limiter with shared defaults (standardHeaders, legacyHeaders). */
export function createRateLimiter({ windowMs, max, message, keyPrefix, extra }: RateLimitOpts) {
  return rateLimit({
    windowMs,
    max,
    message: { error: message },
    standardHeaders: true,
    legacyHeaders: false,
    ...(config.cacheSidecarEnabled && {
      store: new GoCacheRateLimitStore(windowMs),
    }),
    ...(keyPrefix && {
      keyGenerator: (req) => {
        const authReq = req as { user?: { userId: string } };
        if (authReq.user?.userId) return `${keyPrefix}:${authReq.user.userId}`;
        return `${keyPrefix}:${ipKeyGenerator(req.ip ?? '127.0.0.1')}`;
      },
    }),
    ...extra,
  });
}
