import { Client, ClientChannel, SFTPWrapper } from 'ssh2';
import type { Duplex } from 'stream';

const SSH_READY_TIMEOUT_MS = 10_000;
const SSH_KEEPALIVE_INTERVAL_MS = 10_000;

export interface SshConnectionParams {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  /** Optional pre-established tunnel stream — when provided, SSH2 uses this
   *  instead of opening a direct TCP connection to host:port. */
  sock?: Duplex;
}

export interface SshSession {
  client: Client;
  stream: ClientChannel;
  bastionClient?: Client;
}

export interface BastionConnectionParams {
  bastionHost: string;
  bastionPort: number;
  bastionUsername: string;
  bastionPassword?: string;
  bastionPrivateKey?: string;
  targetHost: string;
  targetPort: number;
  targetUsername: string;
  targetPassword?: string;
  targetPrivateKey?: string;
  targetPassphrase?: string;
  /** Optional pre-established tunnel stream for the bastion leg. */
  sock?: Duplex;
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

    if (params.sock) {
      // Route through pre-established tunnel stream — no direct TCP connection
      client.connect({
        sock: params.sock,
        username: params.username,
        ...(params.privateKey
          ? { privateKey: params.privateKey, passphrase: params.passphrase }
          : { password: params.password }),
        readyTimeout: SSH_READY_TIMEOUT_MS,
        keepaliveInterval: SSH_KEEPALIVE_INTERVAL_MS,
      });
    } else {
      client.connect({
        host: params.host,
        port: params.port,
        username: params.username,
        ...(params.privateKey
          ? { privateKey: params.privateKey, passphrase: params.passphrase }
          : { password: params.password }),
        readyTimeout: SSH_READY_TIMEOUT_MS,
        keepaliveInterval: SSH_KEEPALIVE_INTERVAL_MS,
      });
    }
  });
}

export function createSshConnectionViaBastion(
  params: BastionConnectionParams
): Promise<SshSession> {
  return new Promise((resolve, reject) => {
    const bastionClient = new Client();

    bastionClient.on('ready', () => {
      bastionClient.forwardOut(
        '127.0.0.1',
        0,
        params.targetHost,
        params.targetPort,
        (err, tunnelStream) => {
          if (err) {
            bastionClient.end();
            return reject(new Error(`Bastion tunnel failed: ${err.message}`));
          }

          const targetClient = new Client();

          targetClient.on('ready', () => {
            targetClient.shell(
              { term: 'xterm-256color', cols: 80, rows: 24 },
              (shellErr, stream) => {
                if (shellErr) {
                  targetClient.end();
                  bastionClient.end();
                  return reject(shellErr);
                }
                resolve({ client: targetClient, stream, bastionClient });
              }
            );
          });

          targetClient.on('error', (targetErr) => {
            bastionClient.end();
            reject(new Error(`Target connection via bastion failed: ${targetErr.message}`));
          });

          targetClient.connect({
            sock: tunnelStream,
            username: params.targetUsername,
            ...(params.targetPrivateKey
              ? { privateKey: params.targetPrivateKey, passphrase: params.targetPassphrase }
              : { password: params.targetPassword }),
            readyTimeout: 10000,
            keepaliveInterval: 10000,
          });
        }
      );
    });

    bastionClient.on('error', (bastionErr) => {
      reject(new Error(`Bastion connection failed: ${bastionErr.message}`));
    });

    if (params.sock) {
      // Route through pre-established tunnel stream — no direct TCP to bastion
      bastionClient.connect({
        sock: params.sock,
        username: params.bastionUsername,
        ...(params.bastionPrivateKey
          ? { privateKey: params.bastionPrivateKey }
          : { password: params.bastionPassword }),
        readyTimeout: SSH_READY_TIMEOUT_MS,
        keepaliveInterval: SSH_KEEPALIVE_INTERVAL_MS,
      });
    } else {
      bastionClient.connect({
        host: params.bastionHost,
        port: params.bastionPort,
        username: params.bastionUsername,
        ...(params.bastionPrivateKey
          ? { privateKey: params.bastionPrivateKey }
          : { password: params.bastionPassword }),
        readyTimeout: SSH_READY_TIMEOUT_MS,
        keepaliveInterval: SSH_KEEPALIVE_INTERVAL_MS,
      });
    }
  });
}

export function resizeSshTerminal(
  stream: ClientChannel,
  cols: number,
  rows: number
): void {
  stream.setWindow(rows, cols, 0, 0);
}

export function createSftpSession(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) return reject(err);
      resolve(sftp);
    });
  });
}
