import net from 'net';

/**
 * Find a free TCP port on the local system by binding to port 0,
 * which causes the OS to assign an available ephemeral port.
 */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Failed to determine free port')));
      }
    });
  });
}
