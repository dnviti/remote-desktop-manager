/**
 * Distributed leader election using the shared distributed lock backend.
 *
 * In a multi-instance deployment, only the leader instance should run
 * scheduled jobs (cleanup, rotation, etc.) to prevent duplicate work.
 *
 * When the sidecar is unavailable, all functions fall back to
 * single-instance behavior (every instance runs every job).
 */

import * as cache from './cacheClient';
import { logger } from './logger';
import { config } from '../config';

export const instanceId = `node-${process.pid}-${Date.now()}`;

/**
 * Acquire a distributed lock, run the given function if acquired, and release
 * the lock in the `finally` block.
 *
 * If the distributed cache backend is unavailable or disabled, the function runs unconditionally
 * (single-instance fallback).
 */
export async function runIfLeader(
  lockName: string,
  fn: () => Promise<void>,
  ttlMs = 30_000,
): Promise<void> {
  if (!config.distributedCacheEnabled) {
    await fn();
    return;
  }

  const result = await cache.acquireLock(lockName, ttlMs, instanceId);

  // Distributed cache unavailable — run anyway (single-instance fallback)
  if (result === null) {
    await fn();
    return;
  }

  if (!result.acquired) {
    // Another instance holds the lock — skip
    return;
  }

  let heartbeatTimer: NodeJS.Timeout | null = null;
  try {
    // Renew lock periodically to prevent expiry during long-running fn()
    const heartbeatInterval = Math.max(1000, Math.floor(ttlMs / 3));
    heartbeatTimer = setInterval(() => {
      cache.renewLock(lockName, ttlMs, result.holderId).catch((err) => {
        logger.warn('Leader lock renew failed: %s', err instanceof Error ? err.message : 'Unknown error');
      });
    }, heartbeatInterval);
    await fn();
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    await cache.releaseLock(lockName, result.holderId);
  }
}

/**
 * Start a periodic heartbeat that renews a distributed lock, keeping this
 * instance as the leader. Returns a `stop` function for cleanup on shutdown.
 */
export function startLeaderHeartbeat(
  lockName: string,
  ttlMs = 30_000,
  intervalMs = 10_000,
): { stop: () => void } {
  if (!config.distributedCacheEnabled) {
    return { stop: () => {} };
  }

  // Try to acquire on first call
  cache.acquireLock(lockName, ttlMs, instanceId).catch((err) => {
    logger.warn(
      'Leader heartbeat initial acquire failed: %s',
      err instanceof Error ? err.message : 'Unknown error',
    );
  });

  const timer = setInterval(() => {
    cache.renewLock(lockName, ttlMs, instanceId).then((renewed) => {
      if (!renewed) {
        // Lost leadership — try to re-acquire
        cache.acquireLock(lockName, ttlMs, instanceId).catch(() => {
          // Ignore — another instance may hold the lock
        });
      }
    }).catch((err) => {
      logger.warn(
        'Leader heartbeat renew failed: %s',
        err instanceof Error ? err.message : 'Unknown error',
      );
    });
  }, intervalMs);

  return {
    stop: () => {
      clearInterval(timer);
      cache.releaseLock(lockName, instanceId).catch(() => {
        // Best-effort release on shutdown
      });
    },
  };
}
