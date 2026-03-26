/**
 * Gateway Health Service — tracks connected gateways per protocol type
 * and exposes availability checks used by the readiness endpoint and
 * connection request validation.
 */

import prisma from '../lib/prisma';
import type { GatewayType } from '../lib/prisma';
import { getRegisteredTunnels, getTunnelInfo } from './tunnel.service';
// ---------------------------------------------------------------------------
// Protocol ↔ GatewayType mapping
// ---------------------------------------------------------------------------

type SessionProtocol = 'SSH' | 'RDP' | 'VNC' | 'DATABASE';

const PROTOCOL_TO_GATEWAY_TYPE: Record<SessionProtocol, GatewayType[]> = {
  SSH: ['MANAGED_SSH'],
  RDP: ['GUACD'],
  VNC: ['GUACD'],
  DATABASE: ['DB_PROXY'],
};

const GATEWAY_TYPE_TO_PROTOCOL: Record<string, SessionProtocol> = {
  MANAGED_SSH: 'SSH',
  GUACD: 'RDP', // Also covers VNC — both go through guacd
  DB_PROXY: 'DATABASE',
};

// ---------------------------------------------------------------------------
// Gateway info returned by availability queries
// ---------------------------------------------------------------------------

export interface GatewayInfo {
  gatewayId: string;
  name: string;
  type: GatewayType;
  tunnelConnected: boolean;
  activeStreams: number;
}

export interface ProtocolHealthStatus {
  status: 'connected' | 'disconnected';
  instances: number;
}

export interface GatewayHealthStatus {
  ssh: ProtocolHealthStatus;
  rdp: ProtocolHealthStatus;
  vnc: ProtocolHealthStatus;
  database: ProtocolHealthStatus;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true if at least one gateway with the matching capability
 * is connected via tunnel for the given session protocol.
 */
export async function isProtocolAvailable(protocol: SessionProtocol): Promise<boolean> {
  const gateways = await getAvailableGateways(protocol);
  return gateways.length > 0;
}

/**
 * Lists all connected gateways that can serve the given protocol.
 */
export async function getAvailableGateways(protocol: SessionProtocol): Promise<GatewayInfo[]> {
  const requiredTypes = PROTOCOL_TO_GATEWAY_TYPE[protocol];
  if (!requiredTypes) return [];

  const connectedTunnelIds = new Set(getRegisteredTunnels());

  const gateways = await prisma.gateway.findMany({
    where: {
      type: { in: requiredTypes },
    },
    select: {
      id: true,
      name: true,
      type: true,
    },
  });

  const available: GatewayInfo[] = [];
  for (const gw of gateways) {
    const tunnelConnected = connectedTunnelIds.has(gw.id);
    if (!tunnelConnected) continue;

    const info = getTunnelInfo(gw.id);
    available.push({
      gatewayId: gw.id,
      name: gw.name,
      type: gw.type,
      tunnelConnected: true,
      activeStreams: info?.activeStreams ?? 0,
    });
  }

  return available;
}

/**
 * Returns an overall health status object covering all protocol types.
 */
export async function getHealthStatus(): Promise<GatewayHealthStatus> {
  const connectedTunnelIds = new Set(getRegisteredTunnels());

  const gateways = await prisma.gateway.findMany({
    select: { id: true, type: true },
  });

  const counts: Record<SessionProtocol, number> = {
    SSH: 0,
    RDP: 0,
    VNC: 0,
    DATABASE: 0,
  };

  for (const gw of gateways) {
    if (!connectedTunnelIds.has(gw.id)) continue;

    const protocol = GATEWAY_TYPE_TO_PROTOCOL[gw.type];
    if (protocol) {
      counts[protocol]++;
      // GUACD serves both RDP and VNC
      if (gw.type === 'GUACD') {
        counts.VNC++;
      }
    }
  }

  const toStatus = (count: number): ProtocolHealthStatus => ({
    status: count > 0 ? 'connected' : 'disconnected',
    instances: count,
  });

  return {
    ssh: toStatus(counts.SSH),
    rdp: toStatus(counts.RDP),
    vnc: toStatus(counts.VNC),
    database: toStatus(counts.DATABASE),
  };
}

/**
 * Checks whether all required gateway types (from config) have at least
 * one connected tunnel. Used by the readiness endpoint.
 *
 * Returns an object with `allAvailable` flag and per-type details.
 */
export async function checkRequiredGateways(
  requiredTypes: Array<'MANAGED_SSH' | 'GUACD' | 'DB_PROXY'>,
): Promise<{
  allAvailable: boolean;
  missing: string[];
  details: GatewayHealthStatus;
}> {
  const details = await getHealthStatus();

  const typeToProtocol: Record<string, SessionProtocol> = {
    MANAGED_SSH: 'SSH',
    GUACD: 'RDP',
    DB_PROXY: 'DATABASE',
  };

  const missing: string[] = [];
  for (const t of requiredTypes) {
    const protocol = typeToProtocol[t];
    if (!protocol) continue;
    const key = protocol.toLowerCase() as keyof GatewayHealthStatus;
    if (details[key].status === 'disconnected') {
      missing.push(t);
    }
  }

  return {
    allAvailable: missing.length === 0,
    missing,
    details,
  };
}
