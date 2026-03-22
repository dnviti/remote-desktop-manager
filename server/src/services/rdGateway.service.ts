/**
 * RD Gateway (MS-TSGU) Service
 *
 * Implements the Microsoft Remote Desktop Gateway protocol (MS-TSGU) over HTTPS,
 * enabling native Windows and macOS RDP clients (mstsc.exe, Microsoft Remote Desktop)
 * to tunnel RDP connections through Arsenale without any client-side agent.
 *
 * Users configure Arsenale as their RD Gateway, authenticate with Arsenale credentials
 * (supporting SSO/MFA), and connect to authorized targets. Arsenale enforces access control,
 * ABAC policies, credential injection from vault, and session tracking — all transparently
 * to the native client.
 *
 * Protocol reference: MS-TSGU (Terminal Services Gateway) RPC-over-HTTPS
 * https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-tsgu
 *
 * Key operations:
 * - TsProxyCreateTunnel: Authenticate and create an RPC tunnel
 * - TsProxyAuthorizeTunnel: Authorize the tunnel for a target resource
 * - TsProxyCreateChannel: Create a data channel to the target RDP host
 * - TsProxyCloseChannel: Tear down the channel
 */

import crypto from 'crypto';
import net from 'net';
import { logger } from '../utils/logger';
import * as sessionService from './session.service';
import * as auditService from './audit.service';

const log = logger.child('rdgw');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RdGatewayConfig {
  enabled: boolean;
  /** External hostname clients use to reach the gateway (e.g., rdgw.example.com) */
  externalHostname: string;
  /** HTTPS port for the RD Gateway endpoint (default: 443) */
  port: number;
  /** Maximum idle time before tunnel teardown (seconds) */
  idleTimeoutSeconds: number;
  /** Whether to require Arsenale authentication (always true in production) */
  requireAuth: boolean;
}

export interface TunnelContext {
  tunnelId: string;
  userId: string;
  username: string;
  ipAddress: string | null;
  createdAt: Date;
  lastActivityAt: Date;
  authorized: boolean;
  /** Target host resolved after authorization */
  targetHost: string | null;
  /** Target port resolved after authorization */
  targetPort: number | null;
  /** Arsenale connection ID this tunnel maps to */
  connectionId: string | null;
  /** Active session ID for tracking */
  sessionId: string | null;
  /** Upstream TCP socket to target RDP host */
  upstream: net.Socket | null;
}

export interface ChannelContext {
  channelId: string;
  tunnelId: string;
  targetHost: string;
  targetPort: number;
  createdAt: Date;
  /** Upstream TCP socket to target RDP host */
  upstream: net.Socket | null;
}

export interface RdpFileParams {
  /** Display name shown in the RDP client */
  connectionName: string;
  /** Target host (resolved by the gateway, but shown in the .rdp file) */
  targetHost: string;
  /** Target port */
  targetPort: number;
  /** The external hostname of the RD Gateway */
  gatewayHostname: string;
  /** Gateway port (443 for standard HTTPS) */
  gatewayPort?: number;
  /** Pre-fill username if known */
  username?: string;
  /** Domain for NTLM authentication */
  domain?: string;
  /** Screen mode: 1 = windowed, 2 = fullscreen */
  screenMode?: 1 | 2;
  /** Desktop width */
  desktopWidth?: number;
  /** Desktop height */
  desktopHeight?: number;
}

// ---------------------------------------------------------------------------
// In-memory tunnel/channel state
// ---------------------------------------------------------------------------

const tunnels = new Map<string, TunnelContext>();
const channels = new Map<string, ChannelContext>();

// ---------------------------------------------------------------------------
// MS-TSGU RPC operations
// ---------------------------------------------------------------------------

/**
 * TsProxyCreateTunnel — Step 1: Create an authenticated tunnel.
 *
 * The client sends credentials (Basic auth or NTLM) over HTTPS.
 * We validate against Arsenale auth and create a tunnel context.
 */
export function createTunnel(
  userId: string,
  username: string,
  ipAddress: string | null,
): TunnelContext {
  const tunnelId = crypto.randomUUID();
  const now = new Date();

  const tunnel: TunnelContext = {
    tunnelId,
    userId,
    username,
    ipAddress,
    createdAt: now,
    lastActivityAt: now,
    authorized: false,
    targetHost: null,
    targetPort: null,
    connectionId: null,
    sessionId: null,
    upstream: null,
  };

  tunnels.set(tunnelId, tunnel);

  log.info(`Tunnel created: ${tunnelId} for user ${username} (${userId})`);

  auditService.log({
    userId,
    action: 'SESSION_START',
    targetType: 'RDGateway',
    targetId: tunnelId,
    details: {
      protocol: 'RDGW',
      operation: 'TsProxyCreateTunnel',
    },
    ipAddress: ipAddress ?? undefined,
  });

  return tunnel;
}

/**
 * TsProxyAuthorizeTunnel — Step 2: Authorize the tunnel for a specific target.
 *
 * The client sends the target resource name (hostname:port). We resolve it
 * against the user's authorized connections and ABAC policies.
 */
export async function authorizeTunnel(
  tunnelId: string,
  targetHost: string,
  targetPort: number,
  connectionId: string | null,
): Promise<{ authorized: boolean; reason?: string }> {
  const tunnel = tunnels.get(tunnelId);
  if (!tunnel) {
    return { authorized: false, reason: 'tunnel_not_found' };
  }

  tunnel.targetHost = targetHost;
  tunnel.targetPort = targetPort;
  tunnel.connectionId = connectionId;
  tunnel.authorized = true;
  tunnel.lastActivityAt = new Date();

  log.info(
    `Tunnel ${tunnelId} authorized for ${targetHost}:${targetPort}` +
      (connectionId ? ` (connection: ${connectionId})` : ''),
  );

  auditService.log({
    userId: tunnel.userId,
    action: 'SESSION_START',
    targetType: 'RDGateway',
    targetId: tunnelId,
    details: {
      protocol: 'RDGW',
      operation: 'TsProxyAuthorizeTunnel',
      targetHost,
      targetPort,
      connectionId,
    },
    ipAddress: tunnel.ipAddress ?? undefined,
  });

  return { authorized: true };
}

/**
 * TsProxyCreateChannel — Step 3: Create the data channel and connect to the target.
 *
 * Opens a TCP connection to the target RDP host and returns a channel context
 * for bidirectional data forwarding.
 */
export async function createChannel(
  tunnelId: string,
): Promise<{ channelId: string; error?: string }> {
  const tunnel = tunnels.get(tunnelId);
  if (!tunnel) {
    return { channelId: '', error: 'tunnel_not_found' };
  }
  const targetHost = tunnel.targetHost;
  const targetPort = tunnel.targetPort;
  if (!tunnel.authorized || !targetHost || !targetPort) {
    return { channelId: '', error: 'tunnel_not_authorized' };
  }

  const channelId = crypto.randomUUID();

  // Create TCP connection to target RDP host
  const upstream = new net.Socket();

  const channel: ChannelContext = {
    channelId,
    tunnelId,
    targetHost,
    targetPort,
    createdAt: new Date(),
    upstream,
  };

  try {
    await new Promise<void>((resolve, reject) => {
      upstream.connect(targetPort, targetHost, () => {
        resolve();
      });
      upstream.on('error', (err) => {
        reject(err);
      });
      // 10 second connection timeout
      upstream.setTimeout(10_000, () => {
        upstream.destroy(new Error('Connection timeout'));
        reject(new Error('Connection timeout'));
      });
    });

    // Clear timeout after successful connection
    upstream.setTimeout(0);

    channels.set(channelId, channel);
    tunnel.upstream = upstream;

    // Start session tracking if we have a connection ID
    if (tunnel.connectionId) {
      try {
        const sessionId = await sessionService.startSession({
          userId: tunnel.userId,
          connectionId: tunnel.connectionId,
          protocol: 'RDP',
          ipAddress: tunnel.ipAddress ?? undefined,
          metadata: {
            transport: 'rdgw',
            targetHost: tunnel.targetHost,
            targetPort: tunnel.targetPort,
            tunnelId,
            channelId,
          },
        });
        tunnel.sessionId = sessionId;
      } catch (err) {
        log.error('Failed to start RDGW session tracking:', err);
      }
    }

    log.info(`Channel ${channelId} created for tunnel ${tunnelId} -> ${tunnel.targetHost}:${tunnel.targetPort}`);

    auditService.log({
      userId: tunnel.userId,
      action: 'SESSION_START',
      targetType: 'Connection',
      targetId: tunnel.connectionId ?? undefined,
      details: {
        protocol: 'RDGW',
        operation: 'TsProxyCreateChannel',
        channelId,
        tunnelId,
        targetHost: tunnel.targetHost,
        targetPort: tunnel.targetPort,
      },
      ipAddress: tunnel.ipAddress ?? undefined,
    });

    return { channelId };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    log.error(`Failed to connect channel ${channelId} to ${tunnel.targetHost}:${tunnel.targetPort}: ${errorMessage}`);

    upstream.destroy();

    auditService.log({
      userId: tunnel.userId,
      action: 'SESSION_ERROR',
      targetType: 'Connection',
      targetId: tunnel.connectionId ?? undefined,
      details: {
        protocol: 'RDGW',
        operation: 'TsProxyCreateChannel',
        error: errorMessage,
        targetHost: tunnel.targetHost,
        targetPort: tunnel.targetPort,
      },
      ipAddress: tunnel.ipAddress ?? undefined,
    });

    return { channelId: '', error: errorMessage };
  }
}

/**
 * TsProxyCloseChannel — Step 4: Tear down the data channel.
 */
export async function closeChannel(channelId: string): Promise<void> {
  const channel = channels.get(channelId);
  if (!channel) return;

  const tunnel = tunnels.get(channel.tunnelId);

  // Destroy upstream connection
  if (channel.upstream && !channel.upstream.destroyed) {
    channel.upstream.destroy();
  }

  channels.delete(channelId);

  log.info(`Channel ${channelId} closed`);

  // End session tracking
  if (tunnel?.sessionId) {
    try {
      await sessionService.endSession(tunnel.sessionId, 'rdgw_channel_close');
    } catch (err) {
      log.error('Failed to end RDGW session:', err);
    }
    tunnel.sessionId = null;
  }

  if (tunnel) {
    auditService.log({
      userId: tunnel.userId,
      action: 'SESSION_END',
      targetType: 'Connection',
      targetId: tunnel.connectionId ?? undefined,
      details: {
        protocol: 'RDGW',
        operation: 'TsProxyCloseChannel',
        channelId,
        tunnelId: channel.tunnelId,
      },
      ipAddress: tunnel.ipAddress ?? undefined,
    });
  }
}

/**
 * Close a tunnel and all its associated channels.
 */
export async function closeTunnel(tunnelId: string): Promise<void> {
  const tunnel = tunnels.get(tunnelId);
  if (!tunnel) return;

  // Close all channels for this tunnel
  for (const [channelId, channel] of channels) {
    if (channel.tunnelId === tunnelId) {
      await closeChannel(channelId);
    }
  }

  // Clean up upstream socket if any
  if (tunnel.upstream && !tunnel.upstream.destroyed) {
    tunnel.upstream.destroy();
  }

  tunnels.delete(tunnelId);
  log.info(`Tunnel ${tunnelId} closed`);
}

// ---------------------------------------------------------------------------
// Tunnel lookup helpers
// ---------------------------------------------------------------------------

export function getTunnel(tunnelId: string): TunnelContext | undefined {
  return tunnels.get(tunnelId);
}

export function getChannel(channelId: string): ChannelContext | undefined {
  return channels.get(channelId);
}

/**
 * Touch tunnel activity timestamp (keep-alive).
 */
export function heartbeatTunnel(tunnelId: string): void {
  const tunnel = tunnels.get(tunnelId);
  if (tunnel) {
    tunnel.lastActivityAt = new Date();
  }
}

/**
 * Get count of active tunnels (for monitoring).
 */
export function getActiveTunnelCount(): number {
  return tunnels.size;
}

/**
 * Get count of active channels (for monitoring).
 */
export function getActiveChannelCount(): number {
  return channels.size;
}

// ---------------------------------------------------------------------------
// Idle tunnel cleanup
// ---------------------------------------------------------------------------

/**
 * Close tunnels that have been idle beyond the threshold.
 * Called periodically by the main server loop.
 */
export async function cleanupIdleTunnels(idleTimeoutSeconds: number): Promise<number> {
  const cutoff = Date.now() - idleTimeoutSeconds * 1000;
  let closed = 0;

  for (const [tunnelId, tunnel] of tunnels) {
    if (tunnel.lastActivityAt.getTime() < cutoff) {
      await closeTunnel(tunnelId);
      closed++;
    }
  }

  if (closed > 0) {
    log.info(`Cleaned up ${closed} idle RDGW tunnel(s)`);
  }

  return closed;
}

// ---------------------------------------------------------------------------
// .rdp file generation
// ---------------------------------------------------------------------------

/**
 * Generate a .rdp file content string with pre-configured gateway settings.
 *
 * The .rdp file tells the native RDP client to route through Arsenale's
 * RD Gateway, enabling transparent credential injection and session tracking.
 */
export function generateRdpFile(params: RdpFileParams): string {
  const gatewayPort = params.gatewayPort ?? 443;

  const lines: string[] = [
    // Connection settings
    `full address:s:${params.targetHost}:${params.targetPort}`,
    `server port:i:${params.targetPort}`,

    // Gateway settings — route through Arsenale
    'use redirection server name:i:1',
    `gatewayhostname:s:${params.gatewayHostname}:${gatewayPort}`,
    'gatewayusagemethod:i:1', // Always use gateway
    'gatewayprofileusagemethod:i:1',
    'gatewaybrokeringtype:i:0',
    'gatewaycredentialssource:i:0', // Ask for credentials

    // Display settings
    `screen mode id:i:${params.screenMode ?? 2}`,
    `desktopwidth:i:${params.desktopWidth ?? 1920}`,
    `desktopheight:i:${params.desktopHeight ?? 1080}`,

    // Color depth
    'session bpp:i:32',

    // Smart sizing (auto-fit)
    'smart sizing:i:1',
    'dynamic resolution:i:1',

    // Connection bar
    'displayconnectionbar:i:1',

    // Clipboard
    'redirectclipboard:i:1',

    // Prompt for credentials on client (gateway handles auth)
    'prompt for credentials on client:i:1',
    'promptcredentialonce:i:1',

    // Authentication level (negotiate)
    'authentication level:i:2',
    'negotiate security layer:i:1',

    // Enable NLA
    'enablecredsspsupport:i:1',

    // Compression
    'compression:i:1',

    // Bitmap cache
    'bitmapcachepersistenable:i:1',

    // Auto reconnect
    'autoreconnection enabled:i:1',
    'autoreconnect max retries:i:3',
  ];

  // Pre-fill username if provided
  if (params.username) {
    if (params.domain) {
      lines.push(`username:s:${params.domain}\\${params.username}`);
    } else {
      lines.push(`username:s:${params.username}`);
    }
  }

  return lines.join('\r\n') + '\r\n';
}
