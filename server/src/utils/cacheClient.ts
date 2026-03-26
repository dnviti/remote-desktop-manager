/**
 * TypeScript gRPC client for the gocache sidecar.
 *
 * The Go sidecar uses a custom JSON codec (registered as "proto") so all gRPC
 * messages are JSON-encoded, NOT standard protobuf binary. This client matches
 * that by using a manual service definition with JSON serialize/deserialize.
 *
 * Graceful fallback: if the sidecar is unavailable, operations return null/false
 * and log a warning rather than crashing the application.
 */

import { logger } from './logger';

// Types matching the gRPC service definition (JSON-encoded on the wire).
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

const SIDECAR_URL = process.env.CACHE_SIDECAR_URL || 'localhost:6380';

/**
 * Lazily loads gRPC dependencies. Returns false if packages are not installed.
 */
async function loadGrpcModules(): Promise<boolean> {
  if (grpcModule) return true;
  try {
    grpcModule = await import('@grpc/grpc-js');
    return true;
  } catch {
    logger.warn('gRPC packages not installed — cache sidecar client unavailable');
    return false;
  }
}

// --- JSON codec helpers ---
// The Go sidecar registers a JSON codec under the name "proto", so all gRPC
// messages are JSON-encoded. Go's encoding/json encodes []byte as base64.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function jsonRequestSerialize(value: any): Buffer {
  const processed = { ...value };
  for (const key of Object.keys(processed)) {
    if (Buffer.isBuffer(processed[key])) {
      processed[key] = processed[key].toString('base64');
    }
  }
  return Buffer.from(JSON.stringify(processed));
}

function makeResponseDeserialize(bytesFields: string[]) {
  return (buffer: Buffer) => {
    const obj = JSON.parse(buffer.toString());
    for (const field of bytesFields) {
      if (typeof obj[field] === 'string' && obj[field]) {
        obj[field] = Buffer.from(obj[field], 'base64');
      }
    }
    return obj;
  };
}

function makeMethodDef(
  rpcPath: string,
  responseStream: boolean,
  bytesFields: string[],
) {
  return {
    path: rpcPath,
    requestStream: false,
    responseStream,
    requestSerialize: jsonRequestSerialize,
    requestDeserialize: (buf: Buffer) => JSON.parse(buf.toString()),
    responseSerialize: (value: unknown) => Buffer.from(JSON.stringify(value)),
    responseDeserialize: makeResponseDeserialize(bytesFields),
  };
}

/**
 * Returns the singleton cache client, creating it on first call.
 * Returns null if gRPC packages are not installed.
 */
export async function getCacheClient(): Promise<CacheClient | null> {
  if (client) return client;

  const loaded = await loadGrpcModules();
  if (!loaded || !grpcModule) return null;

  try {
    // Manual service definition with JSON serialization to match the Go sidecar's
    // custom JSON codec (see infrastructure/gocache/codec.go).
    const serviceDef = {
      Get: makeMethodDef('/cache.CacheService/Get', false, ['value']),
      Set: makeMethodDef('/cache.CacheService/Set', false, []),
      Delete: makeMethodDef('/cache.CacheService/Delete', false, []),
      Incr: makeMethodDef('/cache.CacheService/Incr', false, []),
      GetDel: makeMethodDef('/cache.CacheService/GetDel', false, ['value']),
      Publish: makeMethodDef('/cache.CacheService/Publish', false, []),
      Subscribe: makeMethodDef('/cache.CacheService/Subscribe', true, ['message']),
      AcquireLock: makeMethodDef('/cache.CacheService/AcquireLock', false, []),
      ReleaseLock: makeMethodDef('/cache.CacheService/ReleaseLock', false, []),
      RenewLock: makeMethodDef('/cache.CacheService/RenewLock', false, []),
      Enqueue: makeMethodDef('/cache.CacheService/Enqueue', false, []),
      Dequeue: makeMethodDef('/cache.CacheService/Dequeue', false, ['message']),
    };

    const CacheService = grpcModule.makeGenericClientConstructor(serviceDef, 'CacheService');
    client = new CacheService(SIDECAR_URL, grpcModule.credentials.createInsecure()) as unknown as CacheClient;
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
