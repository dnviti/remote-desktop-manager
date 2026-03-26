/**
 * Socket.IO cross-instance adapter backed by gocache pub/sub.
 *
 * When multiple Arsenale server instances share the same gocache sidecar,
 * this adapter relays broadcast and serverSideEmit packets across instances
 * so that connected clients on any node receive the events.
 *
 * Falls back to the default in-memory adapter when the sidecar is unavailable
 * or when `config.cacheSidecarEnabled` is false.
 */

import { Adapter } from 'socket.io-adapter';
import * as cache from './cacheClient';
import { logger } from './logger';
import { config } from '../config';

const instanceId = `${process.pid}-${Date.now()}`;

interface AdapterMessage {
  /** Originating instance — used to skip self-echo */
  src: string;
  /** 'broadcast' | 'serverSideEmit' */
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  packet: any;
  /** Serialized broadcast options (rooms + except as arrays) */
  opts?: { rooms: string[]; except: string[] };
}

/**
 * Returns a factory function (adapter constructor) for Socket.IO that uses
 * gocache pub/sub for cross-instance event delivery.
 *
 * Returns `null` if the sidecar is disabled or unavailable — caller should
 * fall back to the default in-memory adapter.
 */
export function createGoCacheAdapterFactory(): ((nsp: { name: string }) => Adapter) | null {
  if (!config.cacheSidecarEnabled) {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function goCacheAdapterFactory(nsp: any): Adapter {
    return new GoCacheAdapter(nsp);
  };
}

class GoCacheAdapter extends Adapter {
  private unsubscribe: (() => void) | null = null;
  private closed = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(nsp: any) {
    super(nsp);
    this.setupSubscription();
  }

  private setupSubscription(): void {
    const channel = 'sio:*';
    const expectedBroadcast = `sio:${this.nsp.name}`;
    const expectedServer = `sio:server:${this.nsp.name}`;

    const pending = cache.subscribe(channel, (ch: string, message: Buffer) => {
      if (this.closed) return;
      try {
        const msg: AdapterMessage = JSON.parse(message.toString());
        // Skip messages from this instance
        if (msg.src === instanceId) return;

        if (msg.type === 'broadcast' && ch === expectedBroadcast) {
          const opts = {
            rooms: new Set(msg.opts?.rooms ?? []),
            except: new Set(msg.opts?.except ?? []),
          };
          super.broadcast(msg.packet, opts);
        } else if (msg.type === 'serverSideEmit' && ch === expectedServer) {
          super.serverSideEmit(msg.packet);
        }
      } catch (err) {
        logger.warn(
          'GoCacheAdapter: failed to process message: %s',
          err instanceof Error ? err.message : 'Unknown error',
        );
      }
    }, true);

    pending.then((unsub) => {
      if (this.closed && unsub) {
        // Already closed before subscription resolved — clean up immediately
        unsub();
      } else {
        this.unsubscribe = unsub;
      }
    }).catch((err) => {
      logger.warn(
        'GoCacheAdapter: subscription setup failed: %s',
        err instanceof Error ? err.message : 'Unknown error',
      );
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  broadcast(packet: any, opts: any): void {
    const channel = `sio:${this.nsp.name}`;
    const msg: AdapterMessage = {
      src: instanceId,
      type: 'broadcast',
      packet,
      opts: {
        rooms: Array.from(opts?.rooms ?? []),
        except: Array.from(opts?.except ?? []),
      },
    };
    cache.publish(channel, Buffer.from(JSON.stringify(msg))).catch((err) => {
      logger.warn(
        'GoCacheAdapter: publish failed: %s',
        err instanceof Error ? err.message : 'Unknown error',
      );
    });
    // Always deliver locally
    super.broadcast(packet, opts);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serverSideEmit(packet: any[]): void {
    const channel = `sio:server:${this.nsp.name}`;
    const msg: AdapterMessage = { src: instanceId, type: 'serverSideEmit', packet };
    cache.publish(channel, Buffer.from(JSON.stringify(msg))).catch((err) => {
      logger.warn(
        'GoCacheAdapter: serverSideEmit publish failed: %s',
        err instanceof Error ? err.message : 'Unknown error',
      );
    });
    super.serverSideEmit(packet);
  }

  close(): void {
    this.closed = true;
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}
