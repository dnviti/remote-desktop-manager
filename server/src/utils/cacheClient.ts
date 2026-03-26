/**
 * TypeScript gRPC client for the gocache sidecar.
 *
 * Uses @grpc/proto-loader for dynamic proto loading — no code generation required.
 * Graceful fallback: if the sidecar is unavailable, operations return null/false
 * and log a warning rather than crashing the application.
 */

import path from 'path';
import { logger } from './logger';

// Types are dynamically loaded, but we define the shape for TypeScript usage.
interface CacheClient {
  Get(
    req: { key: string },
    callback: (err: Error | null, res: { value: Buffer; found: boolean }) => void
  ): void;
  Set(
    req: { key: string; value: Buffer; ttl_ms: number },
    callback: (err: Error | null, res: { ok: boolean }) => void
  ): void;
  Delete(
    req: { key: string },
    callback: (err: Error | null, res: { deleted: boolean }) => void
  ): void;
  Incr(
    req: { key: string; delta: number },
    callback: (err: Error | null, res: { value: number }) => void
  ): void;
  GetDel(
    req: { key: string },
    callback: (err: Error | null, res: { value: Buffer; found: boolean }) => void
  ): void;
  Publish(
    req: { channel: string; message: Buffer },
    callback: (err: Error | null, res: { receivers: number }) => void
  ): void;
  Subscribe(req: { channel: string; pattern: boolean }): NodeJS.ReadableStream;
  AcquireLock(
    req: { name: string; ttl_ms: number; holder_id: string },
    callback: (err: Error | null, res: { acquired: boolean; fencing_token: number }) => void
  ): void;
  ReleaseLock(
    req: { name: string; holder_id: string },
    callback: (err: Error | null, res: { released: boolean }) => void
  ): void;
  RenewLock(
    req: { name: string; ttl_ms: number; holder_id: string },
    callback: (err: Error | null, res: { renewed: boolean }) => void
  ): void;
  Enqueue(
    req: { queue_name: string; message: Buffer },
    callback: (err: Error | null, res: { ok: boolean }) => void
  ): void;
  Dequeue(
    req: { queue_name: string; timeout_ms: number },
    callback: (err: Error | null, res: { message: Buffer; found: boolean }) => void
  ): void;
}

let client: CacheClient | null = null;
let grpcModule: typeof import('@grpc/grpc-js') | null = null;
let protoLoaderModule: typeof import('@grpc/proto-loader') | null = null;

const SIDECAR_URL = process.env.CACHE_SIDECAR_URL || 'localhost:6380';
// CACHE_PROTO_PATH allows overriding the proto file location for Docker/production
// where the infrastructure/ directory is not available. Copy cache.proto into the
// server build context or set this env var to the correct path.
const DEFAULT_PROTO_PATH = path.resolve(__dirname, 'cache.proto');
const PROTO_PATH = process.env.CACHE_PROTO_PATH
  ? path.resolve(process.env.CACHE_PROTO_PATH)
  : DEFAULT_PROTO_PATH;

/**
 * Lazily loads gRPC dependencies. Returns false if packages are not installed.
 */
async function loadGrpcModules(): Promise<boolean> {
  if (grpcModule && protoLoaderModule) return true;
  try {
    grpcModule = await import('@grpc/grpc-js');
    protoLoaderModule = await import('@grpc/proto-loader');
    return true;
  } catch {
    logger.warn('gRPC packages not installed — cache sidecar client unavailable');
    return false;
  }
}

/**
 * Returns the singleton cache client, creating it on first call.
 * Returns null if gRPC packages are not installed or the proto file is missing.
 */
export async function getCacheClient(): Promise<CacheClient | null> {
  if (client) return client;

  const loaded = await loadGrpcModules();
  if (!loaded || !grpcModule || !protoLoaderModule) return null;

  try {
    const packageDefinition = await protoLoaderModule.load(PROTO_PATH, {
      keepCase: true,
      longs: Number,
      enums: String,
      defaults: true,
      oneofs: true,
    });

    const proto = grpcModule.loadPackageDefinition(packageDefinition) as Record<string, unknown>;
    const cachePackage = proto.cache as Record<string, unknown>;
    const CacheService = cachePackage.CacheService as new (
      address: string,
      credentials: ReturnType<typeof import('@grpc/grpc-js').credentials.createInsecure>
    ) => CacheClient;

    client = new CacheService(SIDECAR_URL, grpcModule.credentials.createInsecure());
    logger.info('Cache sidecar client connected to [REDACTED]');
    return client;
  } catch (err) {
    logger.warn(
      'Failed to initialize cache sidecar client: %s',
      err instanceof Error ? err.message : 'Unknown error'
    );
    return null;
  }
}

// --- Async wrappers ---

function promisify<TReq, TRes>(
  method: (req: TReq, cb: (err: Error | null, res: TRes) => void) => void,
  req: TReq,
  ctx: CacheClient
): Promise<TRes | null> {
  return new Promise((resolve) => {
    try {
      method.call(ctx, req, (err: Error | null, res: TRes) => {
        if (err) {
          logger.warn('Cache sidecar call failed: %s', err.message);
          resolve(null);
          return;
        }
        resolve(res);
      });
    } catch (err) {
      logger.warn(
        'Cache sidecar unavailable: %s',
        err instanceof Error ? err.message : 'Unknown error'
      );
      resolve(null);
    }
  });
}

/**
 * Set a key-value pair with optional TTL in milliseconds.
 */
export async function set(
  key: string,
  value: string | Buffer,
  opts?: { ttl?: number }
): Promise<boolean> {
  const c = await getCacheClient();
  if (!c) return false;
  const buf = typeof value === 'string' ? Buffer.from(value) : value;
  const res = await promisify(c.Set, { key, value: buf, ttl_ms: opts?.ttl ?? 0 }, c);
  return res?.ok ?? false;
}

/**
 * Get a value by key. Returns null if not found or sidecar unavailable.
 */
export async function get(key: string): Promise<Buffer | null> {
  const c = await getCacheClient();
  if (!c) return null;
  const res = await promisify(c.Get, { key }, c);
  if (!res?.found) return null;
  return res.value;
}

/**
 * Delete a key. Returns true if the key existed.
 */
export async function del(key: string): Promise<boolean> {
  const c = await getCacheClient();
  if (!c) return false;
  const res = await promisify(c.Delete, { key }, c);
  return res?.deleted ?? false;
}

/**
 * Increment a key's value by delta (default 1). Returns the new value or null.
 */
export async function incr(key: string, delta = 1): Promise<number | null> {
  const c = await getCacheClient();
  if (!c) return null;
  const res = await promisify(c.Incr, { key, delta }, c);
  return res?.value ?? null;
}

/**
 * Atomically get and delete a key.
 */
export async function getdel(key: string): Promise<Buffer | null> {
  const c = await getCacheClient();
  if (!c) return null;
  const res = await promisify(c.GetDel, { key }, c);
  if (!res?.found) return null;
  return res.value;
}

/**
 * Publish a message to a channel. Returns the number of receivers.
 */
export async function publish(channel: string, message: string | Buffer): Promise<number> {
  const c = await getCacheClient();
  if (!c) return 0;
  const buf = typeof message === 'string' ? Buffer.from(message) : message;
  const res = await promisify(c.Publish, { channel, message: buf }, c);
  return res?.receivers ?? 0;
}

/**
 * Subscribe to a channel. Calls the callback for each message.
 * Returns an unsubscribe function, or null if unavailable.
 */
export async function subscribe(
  channel: string,
  callback: (channel: string, message: Buffer) => void,
  pattern = false
): Promise<(() => void) | null> {
  const c = await getCacheClient();
  if (!c) return null;

  try {
    const stream = c.Subscribe({ channel, pattern });

    stream.on('data', (data: { channel: string; message: Buffer }) => {
      callback(data.channel, data.message);
    });

    stream.on('error', (err: Error) => {
      logger.warn('Cache subscription error: %s', err.message);
    });

    return () => {
      (stream as unknown as { cancel(): void }).cancel();
    };
  } catch (err) {
    logger.warn(
      'Cache subscribe failed: %s',
      err instanceof Error ? err.message : 'Unknown error'
    );
    return null;
  }
}

/**
 * Acquire a distributed lock. Returns { acquired, fencingToken, holderId } or null.
 * The holderId is returned so callers can later call releaseLock/renewLock even when
 * a default holderId was auto-generated.
 */
export async function acquireLock(
  name: string,
  ttlMs: number,
  holderId?: string
): Promise<{ acquired: boolean; fencingToken: number; holderId: string } | null> {
  const c = await getCacheClient();
  if (!c) return null;
  const holder = holderId ?? `node-${process.pid}-${Date.now()}`;
  const res = await promisify(
    c.AcquireLock,
    { name, ttl_ms: ttlMs, holder_id: holder },
    c
  );
  if (!res) return null;
  return { acquired: res.acquired, fencingToken: res.fencing_token, holderId: holder };
}

/**
 * Release a distributed lock.
 */
export async function releaseLock(name: string, holderId: string): Promise<boolean> {
  const c = await getCacheClient();
  if (!c) return false;
  const res = await promisify(c.ReleaseLock, { name, holder_id: holderId }, c);
  return res?.released ?? false;
}

/**
 * Renew a distributed lock's TTL.
 */
export async function renewLock(name: string, ttlMs: number, holderId: string): Promise<boolean> {
  const c = await getCacheClient();
  if (!c) return false;
  const res = await promisify(c.RenewLock, { name, ttl_ms: ttlMs, holder_id: holderId }, c);
  return res?.renewed ?? false;
}

/**
 * Enqueue a message onto a named queue.
 */
export async function enqueue(queueName: string, message: string | Buffer): Promise<boolean> {
  const c = await getCacheClient();
  if (!c) return false;
  const buf = typeof message === 'string' ? Buffer.from(message) : message;
  const res = await promisify(c.Enqueue, { queue_name: queueName, message: buf }, c);
  return res?.ok ?? false;
}

/**
 * Dequeue a message from a named queue with optional timeout in milliseconds.
 */
export async function dequeue(
  queueName: string,
  timeoutMs = 0
): Promise<Buffer | null> {
  const c = await getCacheClient();
  if (!c) return null;
  const res = await promisify(c.Dequeue, { queue_name: queueName, timeout_ms: timeoutMs }, c);
  if (!res?.found) return null;
  return res.message;
}
