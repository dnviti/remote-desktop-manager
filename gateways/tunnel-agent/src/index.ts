/**
 * Tunnel Agent — entry point.
 *
 * Auto-activation: if TUNNEL_SERVER_URL / TUNNEL_TOKEN / TUNNEL_GATEWAY_ID
 * are absent, the process exits cleanly (dormant mode — no side effects).
 *
 * This allows the binary to be bundled into gateway container images and
 * called unconditionally from the entrypoint; containers without tunnel
 * configuration simply skip it.
 */

import { loadConfig } from './config';
import { TunnelAgent } from './tunnel';

const cfg = loadConfig();

if (!cfg) {
  // Dormant mode — tunnel env vars not configured, exit cleanly
  process.stdout.write('[tunnel-agent] Tunnel env vars not set — dormant mode, exiting\n');
  process.exit(0);
}

process.stdout.write(`[tunnel-agent] Starting (gateway=${cfg.gatewayId}, server=${cfg.serverUrl})\n`);

const agent = new TunnelAgent(cfg);
agent.start();
