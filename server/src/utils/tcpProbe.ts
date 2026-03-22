import net from 'net';
import { validateHost } from './hostValidation';

export interface TcpProbeResult {
  reachable: boolean;
  latencyMs: number | null;
  error: string | null;
}

export async function tcpProbe(host: string, port: number, timeoutMs = 5000): Promise<TcpProbeResult> {
  // Validate host against SSRF (blocks loopback, link-local, metadata IPs)
  try {
    await validateHost(host);
  } catch (err) {
    // Return a failed probe result instead of rejecting the promise,
    // so callers (probeAndPersist, testGatewayConnectivity) can persist
    // the UNREACHABLE status and error message to the database.
    return {
      reachable: false,
      latencyMs: null,
      error: err instanceof Error ? err.message : 'Host validation failed',
    };
  }

  const start = Date.now();

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (reachable: boolean, error: string | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({
        reachable,
        latencyMs: reachable ? Date.now() - start : null,
        error,
      });
    };

    socket.setTimeout(timeoutMs);
    socket.on('connect', () => finish(true, null));
    socket.on('timeout', () => finish(false, 'Connection timed out'));
    socket.on('error', (err) => finish(false, err.message));

    socket.connect(port, host);
  });
}
