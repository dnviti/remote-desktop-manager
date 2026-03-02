import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { SFTPWrapper } from 'ssh2';
import { config } from '../config';
import { AuthPayload, SftpEntry } from '../types';
import { createSshConnection, createSshConnectionViaBastion, createSftpSession, resizeSshTerminal, SshSession } from '../services/ssh.service';
import { getConnectionCredentials, getConnection } from '../services/connection.service';
import { getGatewayCredentials } from '../services/gateway.service';
import { getPrivateKey as getTenantPrivateKey } from '../services/sshkey.service';
import * as auditService from '../services/audit.service';
import { formatDuration } from '../utils/format';

interface ActiveTransfer {
  stream: NodeJS.ReadableStream | NodeJS.WritableStream;
  timeout: ReturnType<typeof setTimeout>;
  bytesTransferred: number;
  totalBytes: number;
  filename: string;
}

const activeSessions = new Map<string, SshSession>();

function sanitizePath(p: string): string {
  if (p.includes('\0')) throw new Error('Invalid path');
  const normalized = path.posix.normalize(p);
  if (!normalized.startsWith('/')) throw new Error('Path must be absolute');
  return normalized;
}

export function setupSshHandler(io: Server) {
  const sshNamespace = io.of('/ssh');

  sshNamespace.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required'));

    try {
      const payload = jwt.verify(token, config.jwtSecret) as AuthPayload;
      (socket as Socket & { user: AuthPayload }).user = payload;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  sshNamespace.on('connection', (socket) => {
    const user = (socket as Socket & { user: AuthPayload }).user;
    let currentSession: SshSession | null = null;
    let sftpSession: SFTPWrapper | null = null;
    const activeTransfers = new Map<string, ActiveTransfer>();

    // Session audit tracking
    let sessionStartTime: number | null = null;
    let sessionConnectionId: string | null = null;
    let sessionHost: string | null = null;
    let sessionPort: number | null = null;
    const clientIp = (socket.handshake.headers['x-forwarded-for'] as string | undefined)
      || socket.handshake.address;

    async function ensureSftp(): Promise<SFTPWrapper> {
      if (sftpSession) return sftpSession;
      if (!currentSession) throw new Error('No active SSH session');
      sftpSession = await createSftpSession(currentSession.client);
      return sftpSession;
    }

    function clearTransfer(transferId: string) {
      const transfer = activeTransfers.get(transferId);
      if (transfer) {
        clearTimeout(transfer.timeout);
        try {
          if ('destroy' in transfer.stream && typeof transfer.stream.destroy === 'function') {
            transfer.stream.destroy();
          }
        } catch { /* ignore cleanup errors */ }
        activeTransfers.delete(transferId);
      }
    }

    function resetTransferTimeout(transferId: string) {
      const transfer = activeTransfers.get(transferId);
      if (!transfer) return;
      clearTimeout(transfer.timeout);
      transfer.timeout = setTimeout(() => {
        socket.emit('sftp:transfer:error', { transferId, message: 'Transfer timed out' });
        clearTransfer(transferId);
      }, 30000);
    }

    // ── Terminal events ──────────────────────────────────────────────

    socket.on('session:start', async (data: { connectionId: string; username?: string; password?: string }) => {
      try {
        if ((data.username && !data.password) || (!data.username && data.password)) {
          socket.emit('session:error', { message: 'Both username and password must be provided together' });
          return;
        }

        const conn = await getConnection(user.userId, data.connectionId, user.tenantId);
        if (conn.type !== 'SSH') {
          socket.emit('session:error', { message: 'Not an SSH connection' });
          return;
        }

        let username: string;
        let password: string;
        let privateKey: string | undefined;
        let passphrase: string | undefined;
        if (data.username && data.password) {
          username = data.username;
          password = data.password;
        } else {
          const creds = await getConnectionCredentials(user.userId, data.connectionId, user.tenantId);
          username = creds.username;
          password = creds.password;
          privateKey = creds.privateKey;
          passphrase = creds.passphrase;
        }

        let session: SshSession;

        if (conn.gateway) {
          if (conn.gateway.type !== 'SSH_BASTION' && conn.gateway.type !== 'MANAGED_SSH') {
            socket.emit('session:error', {
              message: 'Connection gateway must be SSH_BASTION or MANAGED_SSH for SSH connections',
            });
            return;
          }

          if (!user.tenantId) {
            socket.emit('session:error', { message: 'Tenant context required for gateway routing' });
            return;
          }

          let bastionUsername: string;
          let bastionPassword: string | undefined;
          let bastionPrivateKey: string | undefined;

          if (conn.gateway.type === 'MANAGED_SSH') {
            // Managed SSH gateway: use server-managed key pair, fixed username "tunnel"
            const privateKeyBuf = await getTenantPrivateKey(user.tenantId);
            bastionUsername = 'tunnel';
            bastionPrivateKey = privateKeyBuf.toString('utf8');
          } else {
            // SSH_BASTION: decrypt user-supplied credentials from the gateway
            const gatewayCreds = await getGatewayCredentials(user.userId, user.tenantId, conn.gateway.id);
            if (!gatewayCreds.username || (!gatewayCreds.password && !gatewayCreds.sshPrivateKey)) {
              socket.emit('session:error', {
                message: 'Gateway credentials are incomplete. Please configure username and password or SSH key on the gateway.',
              });
              return;
            }
            bastionUsername = gatewayCreds.username;
            bastionPassword = gatewayCreds.password ?? undefined;
            bastionPrivateKey = gatewayCreds.sshPrivateKey ?? undefined;
          }

          session = await createSshConnectionViaBastion({
            bastionHost: conn.gateway.host,
            bastionPort: conn.gateway.port,
            bastionUsername,
            bastionPassword,
            bastionPrivateKey,
            targetHost: conn.host,
            targetPort: conn.port,
            targetUsername: username,
            targetPassword: password,
            targetPrivateKey: privateKey,
            targetPassphrase: passphrase,
          });
        } else {
          session = await createSshConnection({
            host: conn.host,
            port: conn.port,
            username,
            password,
            privateKey,
            passphrase,
          });
        }

        currentSession = session;
        const sessionId = `${user.userId}:${socket.id}`;
        activeSessions.set(sessionId, session);

        socket.emit('session:ready');

        // Audit: session started
        sessionStartTime = Date.now();
        sessionConnectionId = data.connectionId;
        sessionHost = conn.host;
        sessionPort = conn.port;
        auditService.log({
          userId: user.userId,
          action: 'SESSION_START',
          targetType: 'Connection',
          targetId: data.connectionId,
          details: { protocol: 'SSH', host: conn.host, port: conn.port },
          ipAddress: clientIp,
        });

        session.stream.on('data', (data: Buffer) => {
          socket.emit('data', data.toString('utf8'));
        });

        session.stream.on('close', () => {
          socket.emit('session:closed');
          cleanup(sessionId);
        });

        session.client.on('error', (err) => {
          socket.emit('session:error', { message: err.message });
          cleanup(sessionId);
        });

        if (session.bastionClient) {
          session.bastionClient.on('error', (err) => {
            socket.emit('session:error', { message: `Bastion error: ${err.message}` });
            cleanup(sessionId);
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Connection failed';
        socket.emit('session:error', { message });
      }
    });

    socket.on('data', (data: string) => {
      if (currentSession?.stream.writable) {
        currentSession.stream.write(data);
      }
    });

    socket.on('resize', (data: { cols: number; rows: number }) => {
      if (currentSession?.stream) {
        resizeSshTerminal(currentSession.stream, data.cols, data.rows);
      }
    });

    // ── SFTP events ──────────────────────────────────────────────────

    socket.on('sftp:list', async (data: { path: string }, callback?: (res: { entries?: SftpEntry[]; error?: string }) => void) => {
      try {
        const sftp = await ensureSftp();
        const safePath = sanitizePath(data.path);
        sftp.readdir(safePath, (err, list) => {
          if (err) {
            callback?.({ error: err.message });
            return;
          }
          const entries: SftpEntry[] = list.map((item) => {
            const isDir = item.attrs.isDirectory();
            const isLink = item.attrs.isSymbolicLink();
            return {
              name: item.filename,
              size: item.attrs.size,
              type: isLink ? 'symlink' as const : isDir ? 'directory' as const : 'file' as const,
              modifiedAt: new Date((item.attrs.mtime ?? 0) * 1000).toISOString(),
            };
          });
          callback?.({ entries });
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'SFTP error';
        callback?.({ error: message });
      }
    });

    socket.on('sftp:mkdir', async (data: { path: string }, callback?: (res: { error?: string }) => void) => {
      try {
        const sftp = await ensureSftp();
        const safePath = sanitizePath(data.path);
        sftp.mkdir(safePath, (err) => {
          if (err) {
            callback?.({ error: err.message });
            return;
          }
          callback?.({});
        });
      } catch (err) {
        callback?.({ error: err instanceof Error ? err.message : 'SFTP error' });
      }
    });

    socket.on('sftp:delete', async (data: { path: string }, callback?: (res: { error?: string }) => void) => {
      try {
        const sftp = await ensureSftp();
        const safePath = sanitizePath(data.path);
        sftp.unlink(safePath, (err) => {
          if (err) {
            callback?.({ error: err.message });
            return;
          }
          callback?.({});
        });
      } catch (err) {
        callback?.({ error: err instanceof Error ? err.message : 'SFTP error' });
      }
    });

    socket.on('sftp:rmdir', async (data: { path: string }, callback?: (res: { error?: string }) => void) => {
      try {
        const sftp = await ensureSftp();
        const safePath = sanitizePath(data.path);
        sftp.rmdir(safePath, (err) => {
          if (err) {
            callback?.({ error: err.message });
            return;
          }
          callback?.({});
        });
      } catch (err) {
        callback?.({ error: err instanceof Error ? err.message : 'SFTP error' });
      }
    });

    socket.on('sftp:rename', async (data: { oldPath: string; newPath: string }, callback?: (res: { error?: string }) => void) => {
      try {
        const sftp = await ensureSftp();
        const safeOld = sanitizePath(data.oldPath);
        const safeNew = sanitizePath(data.newPath);
        sftp.rename(safeOld, safeNew, (err) => {
          if (err) {
            callback?.({ error: err.message });
            return;
          }
          callback?.({});
        });
      } catch (err) {
        callback?.({ error: err instanceof Error ? err.message : 'SFTP error' });
      }
    });

    socket.on('sftp:upload:start', async (
      data: { remotePath: string; fileSize: number; filename: string },
      callback?: (res: { transferId?: string; error?: string }) => void,
    ) => {
      try {
        if (data.fileSize > config.sftpMaxFileSize) {
          callback?.({ error: `File too large (max ${Math.round(config.sftpMaxFileSize / 1024 / 1024)}MB)` });
          return;
        }
        const sftp = await ensureSftp();
        const safePath = sanitizePath(data.remotePath);
        const transferId = uuidv4();
        const writeStream = sftp.createWriteStream(safePath);

        writeStream.on('error', (err: Error) => {
          socket.emit('sftp:transfer:error', { transferId, message: err.message });
          clearTransfer(transferId);
        });

        const timeout = setTimeout(() => {
          socket.emit('sftp:transfer:error', { transferId, message: 'Transfer timed out' });
          clearTransfer(transferId);
        }, 30000);

        activeTransfers.set(transferId, {
          stream: writeStream,
          timeout,
          bytesTransferred: 0,
          totalBytes: data.fileSize,
          filename: data.filename,
        });

        callback?.({ transferId });
      } catch (err) {
        callback?.({ error: err instanceof Error ? err.message : 'SFTP error' });
      }
    });

    socket.on('sftp:upload:chunk', (
      data: { transferId: string; chunk: Buffer | ArrayBuffer | number[] },
      callback?: (res: { error?: string }) => void,
    ) => {
      const transfer = activeTransfers.get(data.transferId);
      if (!transfer) {
        callback?.({ error: 'Transfer not found' });
        return;
      }

      const buf = Buffer.isBuffer(data.chunk) ? data.chunk : Buffer.from(data.chunk as number[]);
      const writeStream = transfer.stream as NodeJS.WritableStream;

      try {
        (writeStream as ReturnType<SFTPWrapper['createWriteStream']>).write(buf, (err) => {
          if (err) {
            socket.emit('sftp:transfer:error', { transferId: data.transferId, message: err.message });
            clearTransfer(data.transferId);
            callback?.({ error: err.message });
            return;
          }
          transfer.bytesTransferred += buf.length;
          resetTransferTimeout(data.transferId);
          socket.emit('sftp:progress', {
            transferId: data.transferId,
            bytesTransferred: transfer.bytesTransferred,
            totalBytes: transfer.totalBytes,
            filename: transfer.filename,
          });
          callback?.({});
        });
      } catch (err) {
        callback?.({ error: err instanceof Error ? err.message : 'Write error' });
        clearTransfer(data.transferId);
      }
    });

    socket.on('sftp:upload:end', (
      data: { transferId: string },
      callback?: (res: { error?: string }) => void,
    ) => {
      const transfer = activeTransfers.get(data.transferId);
      if (!transfer) {
        callback?.({ error: 'Transfer not found' });
        return;
      }
      const writeStream = transfer.stream as ReturnType<SFTPWrapper['createWriteStream']>;
      writeStream.end(() => {
        socket.emit('sftp:transfer:complete', { transferId: data.transferId });
        clearTransfer(data.transferId);
        callback?.({});
      });
    });

    socket.on('sftp:download:start', async (
      data: { remotePath: string },
      callback?: (res: { transferId?: string; totalBytes?: number; filename?: string; error?: string }) => void,
    ) => {
      try {
        const sftp = await ensureSftp();
        const safePath = sanitizePath(data.remotePath);
        const filename = path.posix.basename(safePath);

        sftp.stat(safePath, (statErr, stats) => {
          if (statErr) {
            callback?.({ error: statErr.message });
            return;
          }

          if (stats.size > config.sftpMaxFileSize) {
            callback?.({ error: `File too large (max ${Math.round(config.sftpMaxFileSize / 1024 / 1024)}MB)` });
            return;
          }

          const transferId = uuidv4();
          const readStream = sftp.createReadStream(safePath, { highWaterMark: config.sftpChunkSize });

          const timeout = setTimeout(() => {
            socket.emit('sftp:transfer:error', { transferId, message: 'Transfer timed out' });
            clearTransfer(transferId);
          }, 30000);

          activeTransfers.set(transferId, {
            stream: readStream,
            timeout,
            bytesTransferred: 0,
            totalBytes: stats.size,
            filename,
          });

          callback?.({ transferId, totalBytes: stats.size, filename });

          readStream.on('data', (chunk: Buffer) => {
            const transfer = activeTransfers.get(transferId);
            if (!transfer) return;
            transfer.bytesTransferred += chunk.length;
            resetTransferTimeout(transferId);
            socket.emit('sftp:download:chunk', { transferId, chunk });
            socket.emit('sftp:progress', {
              transferId,
              bytesTransferred: transfer.bytesTransferred,
              totalBytes: transfer.totalBytes,
              filename: transfer.filename,
            });
          });

          readStream.on('end', () => {
            socket.emit('sftp:download:end', { transferId });
            socket.emit('sftp:transfer:complete', { transferId });
            clearTransfer(transferId);
          });

          readStream.on('error', (err: Error) => {
            socket.emit('sftp:transfer:error', { transferId, message: err.message });
            clearTransfer(transferId);
          });
        });
      } catch (err) {
        callback?.({ error: err instanceof Error ? err.message : 'SFTP error' });
      }
    });

    socket.on('sftp:cancel', (data: { transferId: string }) => {
      const transfer = activeTransfers.get(data.transferId);
      if (transfer) {
        socket.emit('sftp:transfer:cancelled', { transferId: data.transferId });
        clearTransfer(data.transferId);
      }
    });

    // ── Disconnect + Cleanup ─────────────────────────────────────────

    socket.on('disconnect', () => {
      const sessionId = `${user.userId}:${socket.id}`;
      cleanup(sessionId);
    });

    function cleanup(sessionId: string) {
      // Audit: session ended
      if (sessionStartTime && sessionConnectionId) {
        const durationMs = Date.now() - sessionStartTime;
        auditService.log({
          userId: user.userId,
          action: 'SESSION_END',
          targetType: 'Connection',
          targetId: sessionConnectionId,
          details: {
            protocol: 'SSH',
            host: sessionHost,
            port: sessionPort,
            durationMs,
            durationFormatted: formatDuration(durationMs),
          },
          ipAddress: clientIp,
        });
        sessionStartTime = null;
        sessionConnectionId = null;
      }

      // Clean up all active transfers
      for (const [transferId] of activeTransfers) {
        clearTransfer(transferId);
      }

      // Close SFTP session
      if (sftpSession) {
        sftpSession.end();
        sftpSession = null;
      }

      // Close SSH session
      const session = activeSessions.get(sessionId);
      if (session) {
        session.stream.close();
        session.client.end();
        if (session.bastionClient) {
          session.bastionClient.end();
        }
        activeSessions.delete(sessionId);
      }
      currentSession = null;
    }
  });
}
