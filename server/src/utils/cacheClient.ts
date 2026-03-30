/**
 * Shared distributed cache client backed by Redis.
 *
 * Redis is the single coordination backend for KV, TTLs, counters, locks,
 * queues, and pub/sub.
 */

import fs from 'fs';
import { createClient } from 'redis';
import { config } from '../config';
import { logger } from './logger';

type RedisClient = ReturnType<typeof createClient>;

let redisCommandClient: RedisClient | null = null;
let redisCommandClientInit: Promise<RedisClient | null> | null = null;

function redisConfigured(): boolean {
  return config.redisUrl.trim().length > 0;
}

function encodeRedisValue(value: string | Buffer): string {
  const buf = typeof value === 'string' ? Buffer.from(value) : value;
  return buf.toString('base64');
}

function decodeRedisValue(value: string | null): Buffer | null {
  if (!value) return null;
  const trimmed = value.trim();

  // Go services currently write some shared coordination payloads as raw JSON
  // while the legacy Node cache layer still stores base64-encoded strings.
  // Accept both encodings during the migration window.
  if (
    trimmed.startsWith('{') ||
    trimmed.startsWith('[') ||
    trimmed.startsWith('"')
  ) {
    return Buffer.from(value);
  }

  if (/^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length % 4 === 0) {
    const decoded = Buffer.from(value, 'base64');
    if (decoded.length > 0 || value === '') {
      const normalizedInput = value.replace(/=+$/, '');
      const normalizedDecoded = decoded.toString('base64').replace(/=+$/, '');
      if (normalizedInput === normalizedDecoded) {
        return decoded;
      }
    }
  }

  return Buffer.from(value);
}

function buildRedisClient(label: string): RedisClient {
  const socket: {
    tls?: boolean;
    ca?: Buffer;
    cert?: Buffer;
    key?: Buffer;
  } = {};
  const useTls = config.redisTlsEnabled || config.redisUrl.startsWith('rediss://');

  if (useTls) {
    socket.tls = true;
    if (config.redisTlsCa) socket.ca = fs.readFileSync(config.redisTlsCa);
    if (config.redisTlsCert) socket.cert = fs.readFileSync(config.redisTlsCert);
    if (config.redisTlsKey) socket.key = fs.readFileSync(config.redisTlsKey);
  }

  const client = createClient({
    url: config.redisUrl,
    socket,
  });

  client.on('error', (err) => {
    logger.warn('Redis %s client error: %s', label, err instanceof Error ? err.message : 'Unknown error');
  });

  return client;
}

async function getRedisCommandClient(): Promise<RedisClient | null> {
  if (!redisConfigured()) return null;

  if (redisCommandClient?.isOpen) return redisCommandClient;
  if (redisCommandClientInit) return redisCommandClientInit;

  redisCommandClientInit = (async () => {
    try {
      const client = redisCommandClient ?? buildRedisClient('command');
      if (!client.isOpen) {
        await client.connect();
      }
      redisCommandClient = client;
      logger.info('Redis command client connected to [REDACTED]');
      return redisCommandClient;
    } catch (err) {
      logger.warn(
        'Failed to initialize Redis command client: %s',
        err instanceof Error ? err.message : 'Unknown error',
      );
      if (redisCommandClient?.isOpen) {
        redisCommandClient.disconnect();
      }
      redisCommandClient = null;
      return null;
    } finally {
      redisCommandClientInit = null;
    }
  })();

  return redisCommandClientInit;
}

async function createRedisSubscriber(): Promise<RedisClient | null> {
  const commandClient = await getRedisCommandClient();
  if (!commandClient) return null;

  const subscriber = commandClient.duplicate();
  subscriber.on('error', (err) => {
    logger.warn(
      'Redis subscriber client error: %s',
      err instanceof Error ? err.message : 'Unknown error',
    );
  });

  try {
    await subscriber.connect();
    return subscriber;
  } catch (err) {
    logger.warn(
      'Failed to initialize Redis subscriber client: %s',
      err instanceof Error ? err.message : 'Unknown error',
    );
    subscriber.disconnect();
    return null;
  }
}

export async function set(
  key: string,
  value: string | Buffer,
  opts?: { ttl?: number },
): Promise<boolean> {
  const redis = await getRedisCommandClient();
  if (!redis) return false;

  try {
    const encoded = encodeRedisValue(value);
    if ((opts?.ttl ?? 0) > 0) {
      await redis.set(key, encoded, { PX: opts?.ttl });
    } else {
      await redis.set(key, encoded);
    }
    return true;
  } catch (err) {
    logger.warn('Redis SET failed for %s: %s', key, err instanceof Error ? err.message : 'Unknown error');
    return false;
  }
}

export async function get(key: string): Promise<Buffer | null> {
  const redis = await getRedisCommandClient();
  if (!redis) return null;

  try {
    return decodeRedisValue(await redis.get(key));
  } catch (err) {
    logger.warn('Redis GET failed for %s: %s', key, err instanceof Error ? err.message : 'Unknown error');
    return null;
  }
}

export async function del(key: string): Promise<boolean> {
  const redis = await getRedisCommandClient();
  if (!redis) return false;

  try {
    return (await redis.del(key)) > 0;
  } catch (err) {
    logger.warn('Redis DEL failed for %s: %s', key, err instanceof Error ? err.message : 'Unknown error');
    return false;
  }
}

export async function incr(key: string, delta = 1): Promise<number | null> {
  const redis = await getRedisCommandClient();
  if (!redis) return null;

  try {
    return await redis.incrBy(key, delta);
  } catch (err) {
    logger.warn('Redis INCRBY failed for %s: %s', key, err instanceof Error ? err.message : 'Unknown error');
    return null;
  }
}

export async function expire(key: string, ttlMs: number): Promise<boolean> {
  const redis = await getRedisCommandClient();
  if (!redis) return false;

  try {
    return await redis.pExpire(key, ttlMs);
  } catch (err) {
    logger.warn('Redis PEXPIRE failed for %s: %s', key, err instanceof Error ? err.message : 'Unknown error');
    return false;
  }
}

export async function getdel(key: string): Promise<Buffer | null> {
  const redis = await getRedisCommandClient();
  if (!redis) return null;

  try {
    const value = await redis.sendCommand<string | null>(['GETDEL', key]);
    return decodeRedisValue(value);
  } catch (err) {
    logger.warn('Redis GETDEL failed for %s: %s', key, err instanceof Error ? err.message : 'Unknown error');
    return null;
  }
}

export async function publish(channel: string, message: string | Buffer): Promise<number> {
  const redis = await getRedisCommandClient();
  if (!redis) return 0;

  try {
    return await redis.publish(channel, encodeRedisValue(message));
  } catch (err) {
    logger.warn(
      'Redis PUBLISH failed for %s: %s',
      channel,
      err instanceof Error ? err.message : 'Unknown error',
    );
    return 0;
  }
}

export async function subscribe(
  channel: string,
  callback: (channel: string, message: Buffer) => void,
  pattern = false,
): Promise<(() => void) | null> {
  const redis = await createRedisSubscriber();
  if (!redis) return null;

  try {
    if (pattern) {
      await redis.pSubscribe(channel, (message: string, matchedChannel: string) => {
        const decoded = decodeRedisValue(message);
        if (decoded) callback(matchedChannel, decoded);
      });
    } else {
      await redis.subscribe(channel, (message: string, subscribedChannel: string) => {
        const decoded = decodeRedisValue(message);
        if (decoded) callback(subscribedChannel, decoded);
      });
    }

    return () => {
      void (async () => {
        try {
          if (pattern) {
            await redis.pUnsubscribe(channel);
          } else {
            await redis.unsubscribe(channel);
          }
          await redis.quit();
        } catch {
          if (redis.isOpen) {
            redis.disconnect();
          }
        }
      })();
    };
  } catch (err) {
    logger.warn(
      'Redis subscribe failed for %s: %s',
      channel,
      err instanceof Error ? err.message : 'Unknown error',
    );
    if (redis.isOpen) {
      redis.disconnect();
    }
    return null;
  }
}

export async function acquireLock(
  name: string,
  ttlMs: number,
  holderId?: string,
): Promise<{ acquired: boolean; fencingToken: number; holderId: string } | null> {
  const holder = holderId ?? `node-${process.pid}-${Date.now()}`;
  const redis = await getRedisCommandClient();
  if (!redis) return null;

  try {
    const result = await redis.eval(
      `
        local ok = redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2], 'NX')
        if ok then
          local token = redis.call('INCR', KEYS[2])
          return {1, token}
        end
        return {0, 0}
      `,
      {
        keys: [`lock:${name}`, `lock:${name}:fencing`],
        arguments: [holder, String(ttlMs)],
      },
    ) as [number | string, number | string];

    return {
      acquired: Number(result?.[0] ?? 0) === 1,
      fencingToken: Number(result?.[1] ?? 0),
      holderId: holder,
    };
  } catch (err) {
    logger.warn(
      'Redis lock acquire failed for %s: %s',
      name,
      err instanceof Error ? err.message : 'Unknown error',
    );
    return null;
  }
}

export async function releaseLock(name: string, holderId: string): Promise<boolean> {
  const redis = await getRedisCommandClient();
  if (!redis) return false;

  try {
    const released = await redis.eval(
      `
        if redis.call('GET', KEYS[1]) == ARGV[1] then
          return redis.call('DEL', KEYS[1])
        end
        return 0
      `,
      {
        keys: [`lock:${name}`],
        arguments: [holderId],
      },
    );
    return Number(released ?? 0) > 0;
  } catch (err) {
    logger.warn(
      'Redis lock release failed for %s: %s',
      name,
      err instanceof Error ? err.message : 'Unknown error',
    );
    return false;
  }
}

export async function renewLock(name: string, ttlMs: number, holderId: string): Promise<boolean> {
  const redis = await getRedisCommandClient();
  if (!redis) return false;

  try {
    const renewed = await redis.eval(
      `
        if redis.call('GET', KEYS[1]) == ARGV[1] then
          return redis.call('PEXPIRE', KEYS[1], ARGV[2])
        end
        return 0
      `,
      {
        keys: [`lock:${name}`],
        arguments: [holderId, String(ttlMs)],
      },
    );
    return Number(renewed ?? 0) === 1;
  } catch (err) {
    logger.warn(
      'Redis lock renew failed for %s: %s',
      name,
      err instanceof Error ? err.message : 'Unknown error',
    );
    return false;
  }
}

export async function enqueue(queueName: string, message: string | Buffer): Promise<boolean> {
  const redis = await getRedisCommandClient();
  if (!redis) return false;

  try {
    await redis.sendCommand(['LPUSH', queueName, encodeRedisValue(message)]);
    return true;
  } catch (err) {
    logger.warn(
      'Redis LPUSH failed for %s: %s',
      queueName,
      err instanceof Error ? err.message : 'Unknown error',
    );
    return false;
  }
}

export async function dequeue(queueName: string, timeoutMs = 0): Promise<Buffer | null> {
  const redis = await getRedisCommandClient();
  if (!redis) return null;

  try {
    const seconds = timeoutMs > 0 ? Math.max(1, Math.ceil(timeoutMs / 1000)) : 0;
    const res = await redis.sendCommand<string[] | null>(['BRPOP', queueName, String(seconds)]);
    if (res && res.length === 2) {
      return decodeRedisValue(res[1]);
    }
    return null;
  } catch (err) {
    logger.warn(
      'Redis BRPOP failed for %s: %s',
      queueName,
      err instanceof Error ? err.message : 'Unknown error',
    );
    return null;
  }
}
