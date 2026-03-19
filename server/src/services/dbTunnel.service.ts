import net from 'net';
import { Client } from 'ssh2';
import { logger } from '../utils/logger';
import * as auditService from './audit.service';

const log = logger.child('dbTunnel');

// --------------- Types ---------------

export interface DbTunnelParams {
  /** SSH bastion host */
  bastionHost: string;
  bastionPort: number;
  bastionUsername: string;
  bastionPassword?: string;
  bastionPrivateKey?: string;
  bastionPassphrase?: string;

  /** Database target behind the bastion */
  targetDbHost: string;
  targetDbPort: number;

  /** Database credentials (injected from vault) */
  dbUsername?: string;
  dbPassword?: string;
  dbName?: string;
  dbType?: string;

  /** Metadata for audit/tracking */
  userId: string;
  connectionId: string;
  ipAddress?: string;
}

export interface ActiveTunnel {
  id: string;
  sshClient: Client;
  localServer: net.Server;
  localPort: number;
  targetDbHost: string;
  targetDbPort: number;
  dbType?: string;
  userId: string;
  connectionId: string;
  connectionString?: string;
  createdAt: Date;
  lastHealthCheck: Date;
  healthy: boolean;
}

// --------------- In-memory tunnel registry ---------------

const activeTunnels = new Map<string, ActiveTunnel>();

const SSH_READY_TIMEOUT_MS = 15_000;
const SSH_KEEPALIVE_INTERVAL_MS = 10_000;
const HEALTH_CHECK_INTERVAL_MS = 30_000;

let healthCheckTimer: ReturnType<typeof setInterval> | null = null;

// --------------- Core operations ---------------

/**
 * Opens an SSH tunnel to the target database through a bastion host.
 * Allocates a random local port and returns the tunnel info.
 */
export async function openTunnel(params: DbTunnelParams): Promise<ActiveTunnel> {
  const tunnelId = `dbt-${params.userId.slice(0, 8)}-${Date.now()}`;

  const sshClient = new Client();

  return new Promise<ActiveTunnel>((resolve, reject) => {
    sshClient.on('ready', () => {
      // Create a local TCP server that forwards to the DB through the SSH tunnel
      const localServer = net.createServer((localSocket) => {
        sshClient.forwardOut(
          '127.0.0.1',
          localSocket.localPort ?? 0,
          params.targetDbHost,
          params.targetDbPort,
          (err, remoteStream) => {
            if (err) {
              log.error(`Tunnel ${tunnelId}: forward error: ${err.message}`);
              localSocket.destroy();
              return;
            }
            localSocket.pipe(remoteStream).pipe(localSocket);

            remoteStream.on('close', () => localSocket.destroy());
            localSocket.on('close', () => remoteStream.close());
          },
        );
      });

      // Listen on a random available port
      localServer.listen(0, '127.0.0.1', () => {
        const addr = localServer.address();
        if (!addr || typeof addr === 'string') {
          localServer.close();
          sshClient.end();
          return reject(new Error('Failed to bind local port'));
        }

        const localPort = addr.port;
        const connectionString = buildConnectionString(
          params.dbType,
          '127.0.0.1',
          localPort,
          params.dbUsername,
          params.dbPassword,
          params.dbName,
        );

        const tunnel: ActiveTunnel = {
          id: tunnelId,
          sshClient,
          localServer,
          localPort,
          targetDbHost: params.targetDbHost,
          targetDbPort: params.targetDbPort,
          dbType: params.dbType,
          userId: params.userId,
          connectionId: params.connectionId,
          connectionString: connectionString ?? undefined,
          createdAt: new Date(),
          lastHealthCheck: new Date(),
          healthy: true,
        };

        activeTunnels.set(tunnelId, tunnel);
        ensureHealthCheckRunning();

        log.info(
          `Tunnel ${tunnelId} opened: 127.0.0.1:${localPort} -> ${params.targetDbHost}:${params.targetDbPort} via ${params.bastionHost}`,
        );

        auditService.log({
          userId: params.userId,
          action: 'DB_TUNNEL_OPEN',
          targetType: 'Connection',
          targetId: params.connectionId,
          details: {
            tunnelId,
            localPort,
            targetDbHost: params.targetDbHost,
            targetDbPort: params.targetDbPort,
            bastionHost: params.bastionHost,
            dbType: params.dbType ?? 'unknown',
          },
          ipAddress: params.ipAddress,
        });

        resolve(tunnel);
      });

      localServer.on('error', (err) => {
        log.error(`Tunnel ${tunnelId}: local server error: ${err.message}`);
        sshClient.end();
        reject(err);
      });
    });

    sshClient.on('error', (err) => {
      log.error(`Tunnel ${tunnelId}: SSH error: ${err.message}`);

      auditService.log({
        userId: params.userId,
        action: 'DB_TUNNEL_ERROR',
        targetType: 'Connection',
        targetId: params.connectionId,
        details: {
          tunnelId,
          error: err.message,
          bastionHost: params.bastionHost,
          targetDbHost: params.targetDbHost,
          targetDbPort: params.targetDbPort,
        },
        ipAddress: params.ipAddress,
      });

      reject(new Error(`SSH tunnel failed: ${err.message}`));
    });

    sshClient.on('close', () => {
      log.debug(`Tunnel ${tunnelId}: SSH connection closed`);
      cleanupTunnel(tunnelId);
    });

    sshClient.connect({
      host: params.bastionHost,
      port: params.bastionPort,
      username: params.bastionUsername,
      ...(params.bastionPrivateKey
        ? { privateKey: params.bastionPrivateKey, passphrase: params.bastionPassphrase }
        : { password: params.bastionPassword }),
      readyTimeout: SSH_READY_TIMEOUT_MS,
      keepaliveInterval: SSH_KEEPALIVE_INTERVAL_MS,
    });
  });
}

/**
 * Closes an active tunnel by its ID.
 */
export function closeTunnel(tunnelId: string): boolean {
  const tunnel = activeTunnels.get(tunnelId);
  if (!tunnel) return false;

  const durationMs = Date.now() - tunnel.createdAt.getTime();

  auditService.log({
    userId: tunnel.userId,
    action: 'DB_TUNNEL_CLOSE',
    targetType: 'Connection',
    targetId: tunnel.connectionId,
    details: {
      tunnelId,
      durationMs,
      localPort: tunnel.localPort,
      targetDbHost: tunnel.targetDbHost,
      targetDbPort: tunnel.targetDbPort,
    },
  });

  cleanupTunnel(tunnelId);
  log.info(`Tunnel ${tunnelId} closed (duration ${durationMs}ms)`);
  return true;
}

/**
 * Closes all tunnels for a given user.
 */
export function closeAllUserTunnels(userId: string): number {
  let count = 0;
  for (const [id, tunnel] of activeTunnels) {
    if (tunnel.userId === userId) {
      closeTunnel(id);
      count++;
    }
  }
  return count;
}

/**
 * Returns information about a tunnel.
 */
export function getTunnel(tunnelId: string): ActiveTunnel | undefined {
  return activeTunnels.get(tunnelId);
}

/**
 * Returns all active tunnels for a user.
 */
export function getUserTunnels(userId: string): ActiveTunnel[] {
  const tunnels: ActiveTunnel[] = [];
  for (const tunnel of activeTunnels.values()) {
    if (tunnel.userId === userId) {
      tunnels.push(tunnel);
    }
  }
  return tunnels;
}

/**
 * Returns tunnel count (for monitoring).
 */
export function getTunnelCount(): number {
  return activeTunnels.size;
}

// --------------- Health monitoring ---------------

function ensureHealthCheckRunning() {
  if (healthCheckTimer) return;
  healthCheckTimer = setInterval(runHealthChecks, HEALTH_CHECK_INTERVAL_MS);
}

function stopHealthCheckIfIdle() {
  if (activeTunnels.size === 0 && healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
  }
}

async function runHealthChecks() {
  for (const [id, tunnel] of activeTunnels) {
    const healthy = await probeTunnel(tunnel);
    tunnel.healthy = healthy;
    tunnel.lastHealthCheck = new Date();

    if (!healthy) {
      log.warn(`Tunnel ${id} health check failed — closing stale tunnel`);
      closeTunnel(id);
    }
  }
}

/**
 * TCP probe: try to connect to the local forwarding port.
 */
function probeTunnel(tunnel: ActiveTunnel): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timeout = 5_000;

    socket.setTimeout(timeout);

    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(tunnel.localPort, '127.0.0.1');
  });
}

// --------------- Cleanup ---------------

function cleanupTunnel(tunnelId: string) {
  const tunnel = activeTunnels.get(tunnelId);
  if (!tunnel) return;

  try {
    tunnel.localServer.close();
  } catch { /* already closed */ }

  try {
    tunnel.sshClient.end();
  } catch { /* already closed */ }

  activeTunnels.delete(tunnelId);
  stopHealthCheckIfIdle();
}

/**
 * Close all tunnels (for graceful shutdown).
 */
export function closeAllTunnels(): void {
  for (const id of activeTunnels.keys()) {
    cleanupTunnel(id);
  }
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
  }
}

// --------------- Connection string builder ---------------

function buildConnectionString(
  dbType: string | undefined,
  host: string,
  port: number,
  username?: string,
  password?: string,
  dbName?: string,
): string | null {
  const userPass = username && password
    ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
    : username
      ? `${encodeURIComponent(username)}@`
      : '';
  const db = dbName ? `/${encodeURIComponent(dbName)}` : '';

  switch (dbType?.toLowerCase()) {
    case 'postgresql':
    case 'postgres':
      return `postgresql://${userPass}${host}:${port}${db}`;
    case 'mysql':
    case 'mariadb':
      return `mysql://${userPass}${host}:${port}${db}`;
    case 'mongodb':
    case 'mongo':
      return `mongodb://${userPass}${host}:${port}${db}`;
    case 'redis':
      return password
        ? `redis://:${encodeURIComponent(password)}@${host}:${port}`
        : `redis://${host}:${port}`;
    case 'mssql':
    case 'sqlserver':
      return `Server=${host},${port};${dbName ? `Database=${dbName};` : ''}${username ? `User Id=${username};` : ''}${password ? `Password=${password};` : ''}`;
    case 'oracle':
      return `${host}:${port}${db ? db : '/ORCL'}`;
    default:
      return `${host}:${port}`;
  }
}
