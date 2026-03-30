/**
 * Gateway event bus using the shared pub/sub backend for event-driven gateway management.
 *
 * When the distributed pub/sub backend is available, events are published to
 * named channels and all server instances receive them via pattern
 * subscription. When it is unavailable, events are routed inline
 * (single-instance fallback).
 */

import { publish, subscribe } from '../utils/cacheClient';
import { config } from '../config';
import { logger } from '../utils/logger';
import { instanceId, runIfLeader } from '../utils/leaderElection';
import { pushKey as grpcPushKey, closeGatewayKeyClient } from '../utils/gatewayKeyClient';
import prisma from '../lib/prisma';
import {
  emitInstancesForGateway,
  emitScalingForGateway,
  emitGatewayData,
} from './gatewayMonitor.service';
import { pushKeysToAllTenantGateways } from './gateway.service';

const log = logger.child('gateway-event-bus');

// ---------------------------------------------------------------------------
// Event types & payload
// ---------------------------------------------------------------------------

export enum GatewayEventType {
  INSTANCE_DEPLOYED   = 'gw:instance:deployed',
  INSTANCE_REMOVED    = 'gw:instance:removed',
  INSTANCE_RECOVERED  = 'gw:instance:recovered',
  INSTANCE_RESTARTED  = 'gw:instance:restarted',
  RECONCILE_COMPLETED = 'gw:reconcile:completed',
  SERVER_READY        = 'gw:server:ready',
}

export interface GatewayEventPayload {
  type: GatewayEventType;
  tenantId: string;
  gatewayId: string;
  instanceId?: string;
  host?: string;
  port?: number;
  timestamp: string;
  sourceInstanceId: string;
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

export async function publishGatewayEvent(
  type: GatewayEventType,
  partial: Omit<GatewayEventPayload, 'type' | 'timestamp' | 'sourceInstanceId'>,
): Promise<void> {
  const event: GatewayEventPayload = {
    ...partial,
    type,
    timestamp: new Date().toISOString(),
    sourceInstanceId: instanceId,
  };

  if (!config.distributedPubSubEnabled) {
    log.debug('[event-bus] Sidecar disabled — routing event inline: %s', type);
    await routeEvent(type, event);
    return;
  }

  try {
    const receivers = await publish(type, JSON.stringify(event));
    log.debug('[event-bus] Published %s (receivers=%d)', type, receivers);

    if (receivers === 0) {
      log.debug('[event-bus] No receivers for %s — routing inline', type);
      await routeEvent(type, event);
    }
  } catch (err) {
    log.warn(
      '[event-bus] Publish failed for %s, routing inline: %s',
      type,
      err instanceof Error ? err.message : 'Unknown error',
    );
    await routeEvent(type, event);
  }
}

// ---------------------------------------------------------------------------
// Subscribe
// ---------------------------------------------------------------------------

export async function startGatewayEventSubscriptions(): Promise<void> {
  if (!config.distributedPubSubEnabled) {
    log.info('[event-bus] Sidecar disabled — event subscriptions skipped (inline routing only)');
    return;
  }

  const unsub = await subscribe(
    'gw:*',
    (channel: string, message: Buffer) => {
      try {
        const event = JSON.parse(message.toString()) as GatewayEventPayload;
        routeEvent(channel as GatewayEventType, event).catch((err) => {
          log.error(
            '[event-bus] routeEvent failed for %s: %s',
            channel,
            err instanceof Error ? err.message : 'Unknown error',
          );
        });
      } catch (err) {
        log.warn(
          '[event-bus] Failed to parse event on channel %s: %s',
          channel,
          err instanceof Error ? err.message : 'Unknown error',
        );
      }
    },
    true,
  );

  if (unsub) {
    log.info('[event-bus] Subscribed to gw:* pattern');
  } else {
    log.warn('[event-bus] Failed to subscribe to gw:* — events will only be handled inline');
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function routeEvent(type: GatewayEventType | string, event: GatewayEventPayload): Promise<void> {
  try {
    switch (type) {
      case GatewayEventType.INSTANCE_DEPLOYED:
        await handleInstanceDeployed(event);
        break;
      case GatewayEventType.INSTANCE_REMOVED:
        await handleInstanceRemoved(event);
        break;
      case GatewayEventType.INSTANCE_RECOVERED:
        await handleInstanceRecovered(event);
        break;
      case GatewayEventType.INSTANCE_RESTARTED:
        await handleInstanceRestarted(event);
        break;
      case GatewayEventType.RECONCILE_COMPLETED:
        await handleReconcileCompleted(event);
        break;
      case GatewayEventType.SERVER_READY:
        await handleServerReady();
        break;
      default:
        log.debug('[event-bus] Unknown event type: %s', type);
    }
  } catch (err) {
    log.error(
      '[event-bus] Handler error for %s: %s',
      type,
      err instanceof Error ? err.message : 'Unknown error',
    );
  }
}

// ---------------------------------------------------------------------------
// Source-gated handlers (skip events from this instance)
// ---------------------------------------------------------------------------

async function handleInstanceDeployed(event: GatewayEventPayload): Promise<void> {
  if (event.sourceInstanceId === instanceId) return;
  emitInstancesForGateway(event.gatewayId).catch(() => {});
  emitGatewayData(event.gatewayId).catch(() => {});
  emitScalingForGateway(event.gatewayId).catch(() => {});
  await autoPushSshKey(event);
}

async function handleInstanceRemoved(event: GatewayEventPayload): Promise<void> {
  if (event.sourceInstanceId === instanceId) return;
  emitInstancesForGateway(event.gatewayId).catch(() => {});
  emitGatewayData(event.gatewayId).catch(() => {});
  emitScalingForGateway(event.gatewayId).catch(() => {});
}

async function handleInstanceRecovered(event: GatewayEventPayload): Promise<void> {
  if (event.sourceInstanceId === instanceId) return;
  emitInstancesForGateway(event.gatewayId).catch(() => {});
  await autoPushSshKey(event);
}

async function handleInstanceRestarted(event: GatewayEventPayload): Promise<void> {
  if (event.sourceInstanceId === instanceId) return;
  emitInstancesForGateway(event.gatewayId).catch(() => {});
}

async function handleReconcileCompleted(event: GatewayEventPayload): Promise<void> {
  if (event.sourceInstanceId === instanceId) return;
  emitInstancesForGateway(event.gatewayId).catch(() => {});
  emitGatewayData(event.gatewayId).catch(() => {});
  emitScalingForGateway(event.gatewayId).catch(() => {});
}

// ---------------------------------------------------------------------------
// Leader-gated handler
// ---------------------------------------------------------------------------

async function handleServerReady(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  await runIfLeader('gw:startup-key-push', async () => {
    await pushKeysToAllTenantGateways();
  });
}

// ---------------------------------------------------------------------------
// SSH key auto-push helper
// ---------------------------------------------------------------------------

async function autoPushSshKey(event: GatewayEventPayload): Promise<void> {
  if (!event.instanceId || !event.host) return;

  const gw = await prisma.gateway.findUnique({
    where: { id: event.gatewayId },
    select: { type: true, tenantId: true },
  });
  if (gw?.type !== 'MANAGED_SSH') return;

  const keyPair = await prisma.sshKeyPair.findUnique({
    where: { tenantId: gw.tenantId },
    select: { publicKey: true },
  });
  if (!keyPair) return;

  const grpcPort = config.gatewayGrpcPort;
  try {
    const res = await grpcPushKey(event.host, grpcPort, keyPair.publicKey);
    if (res.ok) {
      log.info(`[event-bus] Auto-pushed SSH key to instance ${event.instanceId} (${event.host}:${grpcPort})`);
    } else {
      log.warn(`[event-bus] SSH key push to instance ${event.instanceId} failed: ${res.message}`);
    }
  } catch (err) {
    log.warn(`[event-bus] SSH key auto-push failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    closeGatewayKeyClient(event.host, grpcPort);
  }
}
