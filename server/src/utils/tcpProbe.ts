import net from 'net';

export interface TcpProbeResult {
  reachable: boolean;
  latencyMs: number | null;
  error: string | null;
}

export function tcpProbe(host: string, port: number, timeoutMs = 5000): Promise<TcpProbeResult> {
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
