import { Client, ClientChannel } from 'ssh2';

export interface SshConnectionParams {
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface SshSession {
  client: Client;
  stream: ClientChannel;
}

export function createSshConnection(
  params: SshConnectionParams
): Promise<SshSession> {
  return new Promise((resolve, reject) => {
    const client = new Client();

    client.on('ready', () => {
      client.shell(
        {
          term: 'xterm-256color',
          cols: 80,
          rows: 24,
        },
        (err, stream) => {
          if (err) {
            client.end();
            return reject(err);
          }
          resolve({ client, stream });
        }
      );
    });

    client.on('error', (err) => {
      reject(err);
    });

    client.connect({
      host: params.host,
      port: params.port,
      username: params.username,
      password: params.password,
      readyTimeout: 10000,
      keepaliveInterval: 10000,
    });
  });
}

export function resizeSshTerminal(
  stream: ClientChannel,
  cols: number,
  rows: number
): void {
  stream.setWindow(rows, cols, 0, 0);
}
