import net from 'net';
import prisma from '../lib/prisma';
import { config } from '../config';
import { logger } from '../utils/logger';

let serverReady = false;

export function markServerReady(): void {
  serverReady = true;
  logger.info('Server marked as ready');
}

export function isServerReady(): boolean {
  return serverReady;
}

export async function checkDatabase(): Promise<{
  ok: boolean;
  latencyMs: number;
  error?: string;
}> {
  const start = Date.now();
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function checkGuacd(): Promise<{
  ok: boolean;
  latencyMs: number;
  error?: string;
}> {
  const TIMEOUT_MS = 3000;
  const start = Date.now();

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (ok: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ok, latencyMs: Date.now() - start, error });
    };

    socket.setTimeout(TIMEOUT_MS);
    socket.on('connect', () => finish(true));
    socket.on('timeout', () => finish(false, 'Connection timed out'));
    socket.on('error', (err) => finish(false, err.message));

    socket.connect(config.guacdPort, config.guacdHost);
  });
}
