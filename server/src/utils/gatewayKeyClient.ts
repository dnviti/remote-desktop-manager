/**
 * TypeScript gRPC client for the SSH gateway key management service.
 *
 * Same JSON codec pattern as cacheClient.ts — the Go server uses a custom
 * JSON codec registered as "proto", so all gRPC messages are JSON-encoded.
 *
 * Authenticated via mTLS (no bearer tokens). The server presents a client
 * certificate signed by the shared CA.
 */

import fs from 'fs';
import { config } from '../config';
import { logger } from './logger';

const log = logger.child('gateway-key-client');

interface GatewayKeyClient {
  PushKey(
    req: { public_key: string },
    callback: (err: Error | null, res: { ok: boolean; message: string }) => void
  ): void;
  GetKeys(
    req: Record<string, never>,
    callback: (err: Error | null, res: { keys: string[] }) => void
  ): void;
}

let grpcModule: typeof import('@grpc/grpc-js') | null = null;

async function loadGrpcModules(): Promise<boolean> {
  if (grpcModule) return true;
  try {
    grpcModule = await import('@grpc/grpc-js');
    return true;
  } catch {
    log.warn('gRPC packages not installed — gateway key client unavailable');
    return false;
  }
}

// --- JSON codec helpers (same as cacheClient.ts) ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function jsonRequestSerialize(value: any): Buffer {
  return Buffer.from(JSON.stringify(value));
}

function makeResponseDeserialize() {
  return (buffer: Buffer) => JSON.parse(buffer.toString());
}

function makeMethodDef(rpcPath: string) {
  return {
    path: rpcPath,
    requestStream: false,
    responseStream: false,
    requestSerialize: jsonRequestSerialize,
    requestDeserialize: (buf: Buffer) => JSON.parse(buf.toString()),
    responseSerialize: (value: unknown) => Buffer.from(JSON.stringify(value)),
    responseDeserialize: makeResponseDeserialize(),
  };
}

// Client cache: host:port → client instance
const clientCache = new Map<string, GatewayKeyClient>();

/**
 * Creates or retrieves a cached gRPC client for a gateway instance.
 */
export async function getGatewayKeyClient(
  host: string,
  port: number,
): Promise<GatewayKeyClient | null> {
  const addr = `${host}:${port}`;
  const cached = clientCache.get(addr);
  if (cached) return cached;

  const loaded = await loadGrpcModules();
  if (!loaded || !grpcModule) return null;

  try {
    const serviceDef = {
      PushKey: makeMethodDef('/keymanagement.KeyManagement/PushKey'),
      GetKeys: makeMethodDef('/keymanagement.KeyManagement/GetKeys'),
    };

    const KeyManagementService = grpcModule.makeGenericClientConstructor(serviceDef, 'KeyManagement');

    const { gatewayGrpcTlsCa, gatewayGrpcTlsCert, gatewayGrpcTlsKey } = config;

    if (!gatewayGrpcTlsCa || !gatewayGrpcTlsCert || !gatewayGrpcTlsKey) {
      log.error(
        'Gateway key client requires GATEWAY_GRPC_TLS_CA/CERT/KEY for %s; refusing insecure plaintext',
        addr,
      );
      return null;
    }

    const rootCert = fs.readFileSync(gatewayGrpcTlsCa);
    const privateKey = fs.readFileSync(gatewayGrpcTlsKey);
    const certChain = fs.readFileSync(gatewayGrpcTlsCert);
    const channelCredentials = grpcModule.credentials.createSsl(rootCert, privateKey, certChain);
    log.debug('Gateway key client using mTLS for %s', addr);

    const client = new KeyManagementService(addr, channelCredentials) as unknown as GatewayKeyClient;
    clientCache.set(addr, client);
    log.info('Gateway key client connected to %s', addr);
    return client;
  } catch (err) {
    log.warn(
      'Failed to create gateway key client for %s: %s',
      addr,
      err instanceof Error ? err.message : 'Unknown error',
    );
    return null;
  }
}

/**
 * Invalidate a cached client (e.g. on connection failure).
 */
export function closeGatewayKeyClient(host: string, port: number): void {
  const addr = `${host}:${port}`;
  const client = clientCache.get(addr);
  if (client) {
    try {
      (client as unknown as { close(): void }).close();
    } catch { /* ignore */ }
    clientCache.delete(addr);
  }
}

// --- Async wrappers ---

function promisify<TReq, TRes>(
  method: (req: TReq, cb: (err: Error | null, res: TRes) => void) => void,
  req: TReq,
  ctx: GatewayKeyClient,
): Promise<TRes> {
  return new Promise((resolve, reject) => {
    try {
      method.call(ctx, req, (err: Error | null, res: TRes) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(res);
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Push an SSH public key to a gateway instance via gRPC.
 */
export async function pushKey(
  host: string,
  port: number,
  publicKey: string,
): Promise<{ ok: boolean; message: string }> {
  const client = await getGatewayKeyClient(host, port);
  if (!client) {
    throw new Error(`Failed to create gRPC client for ${host}:${port}`);
  }
  return promisify(client.PushKey, { public_key: publicKey }, client);
}

/**
 * Get authorized keys from a gateway instance via gRPC.
 */
export async function getKeys(
  host: string,
  port: number,
): Promise<string[]> {
  const client = await getGatewayKeyClient(host, port);
  if (!client) {
    throw new Error(`Failed to create gRPC client for ${host}:${port}`);
  }
  const res = await promisify(client.GetKeys, {}, client);
  return res.keys;
}
