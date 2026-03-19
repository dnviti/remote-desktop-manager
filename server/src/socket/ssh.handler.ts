import { Server, Socket } from 'socket.io';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { SFTPWrapper } from 'ssh2';
import { config } from '../config';
import { AuthPayload, SftpEntry, DlpPolicy, ResolvedDlpPolicy } from '../types';
import { verifyJwt } from '../utils/jwt';
import { createSshConnection, createSshConnectionViaBastion, createSftpSession, resizeSshTerminal, SshSession } from '../services/ssh.service';
import { getConnectionCredentials, getConnection } from '../services/connection.service';
import { resolveDomainCredentials } from '../services/domain.service';
import { getGatewayCredentials, getDefaultGateway } from '../services/gateway.service';
import { selectInstance } from '../services/loadBalancer.service';
import { isTunnelConnected, openStream } from '../services/tunnel.service';
import { getPrivateKey as getTenantPrivateKey } from '../services/sshkey.service';
import * as sessionService from '../services/session.service';
import * as auditService from '../services/audit.service';
import { AsciicastWriter, startRecording, completeRecording, failRecording, buildRecordingPath } from '../services/recording.service';
import { logger } from '../utils/logger';
import { getSocketClientIp } from '../utils/ip';
import { computeBindingHash, getSocketUserAgent } from '../utils/tokenBinding';
import prisma from '../lib/prisma';
import { resolveDlpPolicy } from '../utils/dlp';
import { checkLateralMovement } from '../services/lateralMovement.service';
import type { EnforcedConnectionSettings } from '../schemas/tenant.schemas';

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
      const payload = verifyJwt<AuthPayload>(token);

      // Token binding check for Socket.IO connections
      if (config.tokenBindingEnabled && payload.ipUaHash) {
        const socketUserAgent = getSocketUserAgent(socket);
        const currentHash = computeBindingHash(
          getSocketClientIp(socket),
          socketUserAgent,
        );
        if (currentHash !== payload.ipUaHash) {
          void auditService.log({
            userId: payload.userId,
            action: 'TOKEN_HIJACK_ATTEMPT',
            ipAddress: getSocketClientIp(socket),
            details: {
              namespace: '/ssh',
              userAgent: socketUserAgent,
              reason: 'Socket.IO token binding mismatch on /ssh',
            },
          });
          return next(new Error('Token binding mismatch'));
        }
      }

      (socket as Socket & { user: AuthPayload }).user = payload;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  sshNamespace.on('connection', (socket) => {
    const user = (socket as Socket & { user: AuthPayload }).user;
    let currentSession: SshSession | null = null;
    let currentConnectionId: string | null = null;
    let sftpSession: SFTPWrapper | null = null;
    const activeTransfers = new Map<string, ActiveTransfer>();

    const clientIp = getSocketClientIp(socket);
    let lastActivityUpdate = 0;
    let recordingWriter: AsciicastWriter | null = null;
    let recordingId: string | null = null;
    let dlpPolicy: ResolvedDlpPolicy | null = null;

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

    socket.on('session:start', async (data: { connectionId: string; username?: string; password?: string; credentialMode?: string }) => {
      // Helper to log connection errors to audit trail
      function logSessionError(error: string, connHost?: string, connPort?: number, gwId?: string | null) {
        auditService.log({
          userId: user.userId,
          action: 'SESSION_ERROR',
          targetType: 'Connection',
          targetId: data.connectionId,
          details: {
            protocol: 'SSH',
            error,
            ...(connHost ? { host: connHost, port: connPort } : {}),
          },
          ipAddress: clientIp,
          gatewayId: gwId ?? undefined,
        });
      }

      try {
        if ((data.username && !data.password) || (!data.username && data.password)) {
          const msg = 'Both username and password must be provided together';
          logSessionError(msg);
          socket.emit('session:error', { message: msg });
          return;
        }

        // Lateral movement anomaly detection (MITRE T1021)
        const lmResult = await checkLateralMovement(user.userId, data.connectionId, clientIp);
        if (!lmResult.allowed) {
          const msg =
            `Session denied: anomalous lateral movement detected. ` +
            `${lmResult.distinctTargets} distinct targets in ${lmResult.windowMinutes} min ` +
            `(threshold: ${lmResult.threshold}). Your account has been temporarily suspended.`;
          logSessionError(msg);
          socket.emit('session:error', { message: msg });
          return;
        }

        const conn = await getConnection(user.userId, data.connectionId, user.tenantId);
        if (conn.type !== 'SSH') {
          const msg = 'Not an SSH connection';
          logSessionError(msg, conn.host, conn.port, conn.gatewayId);
          socket.emit('session:error', { message: msg });
          return;
        }

        // Resolve DLP policy: tenant floor + connection override
        const tenantDlp = user.tenantId
          ? await prisma.tenant.findUnique({
              where: { id: user.tenantId },
              select: { dlpDisableCopy: true, dlpDisablePaste: true, dlpDisableDownload: true, dlpDisableUpload: true, enforcedConnectionSettings: true },
            })
          : null;
        const tenantEnforced = (tenantDlp?.enforcedConnectionSettings as EnforcedConnectionSettings) ?? null;
        dlpPolicy = resolveDlpPolicy(
          tenantDlp ?? { dlpDisableCopy: false, dlpDisablePaste: false, dlpDisableDownload: false, dlpDisableUpload: false },
          conn.dlpPolicy as DlpPolicy | null,
        );

        let username: string;
        let password: string;
        let privateKey: string | undefined;
        let passphrase: string | undefined;
        let credentialSource: 'saved' | 'domain' | 'manual' = 'saved';

        if (data.credentialMode === 'domain') {
          try {
            const domainCreds = await resolveDomainCredentials(user.userId);
            if (!domainCreds.domainUsername || !domainCreds.password) {
              const msg = 'Domain credentials are incomplete. Configure your domain profile in Settings first.';
              logSessionError(msg, conn.host, conn.port, conn.gatewayId);
              socket.emit('session:error', { message: msg });
              return;
            }
            username = domainCreds.domainUsername;
            password = domainCreds.password;
            credentialSource = 'domain';
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to resolve domain credentials';
            logSessionError(msg, conn.host, conn.port, conn.gatewayId);
            socket.emit('session:error', { message: msg });
            return;
          }
        } else if (data.username && data.password) {
          username = data.username;
          password = data.password;
          credentialSource = 'manual';
        } else {
          const creds = await getConnectionCredentials(user.userId, data.connectionId, user.tenantId);
          username = creds.username;
          password = creds.password;
          privateKey = creds.privateKey;
          passphrase = creds.passphrase;
        }

        let session: SshSession;
        let selectedInstanceId: string | undefined;
        let routingDecision: { strategy: string; candidateCount: number; selectedSessionCount: number } | undefined;

        // Resolve gateway: explicit > tenant default > none
        const gateway = conn.gateway
          ?? (user.tenantId
            ? (await getDefaultGateway(user.tenantId, 'MANAGED_SSH') ?? await getDefaultGateway(user.tenantId, 'SSH_BASTION'))
            : null);

        if (gateway) {
          if (gateway.type !== 'SSH_BASTION' && gateway.type !== 'MANAGED_SSH') {
            const msg = 'Connection gateway must be SSH_BASTION or MANAGED_SSH for SSH connections';
            logSessionError(msg, conn.host, conn.port, gateway.id);
            socket.emit('session:error', { message: msg });
            return;
          }

          if (!user.tenantId) {
            const msg = 'Tenant context required for gateway routing';
            logSessionError(msg, conn.host, conn.port, gateway.id);
            socket.emit('session:error', { message: msg });
            return;
          }

          let bastionUsername: string;
          let bastionPassword: string | undefined;
          let bastionPrivateKey: string | undefined;

          if (gateway.type === 'MANAGED_SSH') {
            // Managed SSH gateway: use server-managed key pair, fixed username "tunnel"
            const privateKeyBuf = await getTenantPrivateKey(user.tenantId);
            bastionUsername = 'tunnel';
            bastionPrivateKey = privateKeyBuf.toString('utf8');
          } else {
            // SSH_BASTION: decrypt user-supplied credentials from the gateway
            const gatewayCreds = await getGatewayCredentials(user.userId, user.tenantId, gateway.id);
            if (!gatewayCreds.username || (!gatewayCreds.password && !gatewayCreds.sshPrivateKey)) {
              const msg = 'Gateway credentials are incomplete. Please configure username and password or SSH key on the gateway.';
              logSessionError(msg, conn.host, conn.port, gateway.id);
              socket.emit('session:error', { message: msg });
              return;
            }
            bastionUsername = gatewayCreds.username;
            bastionPassword = gatewayCreds.password ?? undefined;
            bastionPrivateKey = gatewayCreds.sshPrivateKey ?? undefined;
          }

          let bastionHost = gateway.host;
          let bastionPort = gateway.port;

          if (gateway.isManaged) {
            const inst = await selectInstance(gateway.id, gateway.lbStrategy);
            if (inst) {
              bastionHost = inst.host;
              bastionPort = inst.port;
              selectedInstanceId = inst.id;
              routingDecision = {
                strategy: inst.strategy,
                candidateCount: inst.candidateCount,
                selectedSessionCount: inst.selectedSessionCount,
              };
            }
          }

          // Tunnel routing: when the gateway has a zero-trust tunnel connected,
          // open a multiplexed stream to the bastion host instead of a direct TCP connection.
          if (gateway.tunnelEnabled) {
            if (!isTunnelConnected(gateway.id)) {
              const msg = 'Gateway tunnel is disconnected — the gateway may be unreachable';
              logSessionError(msg, conn.host, conn.port, gateway.id);
              socket.emit('session:error', { message: msg });
              return;
            }
            const tunnelSock = await openStream(gateway.id, bastionHost, bastionPort);
            session = await createSshConnectionViaBastion({
              bastionHost,
              bastionPort,
              bastionUsername,
              bastionPassword,
              bastionPrivateKey,
              targetHost: conn.host,
              targetPort: conn.port,
              targetUsername: username,
              targetPassword: password,
              targetPrivateKey: privateKey,
              targetPassphrase: passphrase,
              sock: tunnelSock,
            });
          } else {
            session = await createSshConnectionViaBastion({
              bastionHost,
              bastionPort,
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
          }
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
        currentConnectionId = data.connectionId;
        const sessionId = `${user.userId}:${socket.id}`;
        activeSessions.set(sessionId, session);

        socket.emit('session:ready', { dlpPolicy, enforcedSshSettings: tenantEnforced?.ssh ?? null });

        // Start recording if enabled
        if (config.recordingEnabled) {
          try {
            const recPath = buildRecordingPath(user.userId, data.connectionId, 'SSH', 'cast');
            recordingWriter = new AsciicastWriter(recPath);
            await recordingWriter.open(80, 24);
            recordingId = await startRecording({
              userId: user.userId,
              connectionId: data.connectionId,
              protocol: 'SSH',
              format: 'asciicast',
              filePath: recPath,
              width: 80,
              height: 24,
            });
          } catch (recErr) {
            logger.error('Failed to start SSH recording:', recErr);
            recordingWriter = null;
            recordingId = null;
          }
        }

        // Create persistent session record
        sessionService.startSession({
          userId: user.userId,
          connectionId: data.connectionId,
          gatewayId: gateway?.id ?? conn.gatewayId ?? undefined,
          instanceId: selectedInstanceId,
          protocol: 'SSH',
          socketId: socket.id,
          ipAddress: clientIp,
          metadata: { host: conn.host, port: conn.port, credentialSource },
          routingDecision,
        }).catch((err) => {
          logger.error('Failed to persist SSH session record:', err);
        });

        session.stream.on('data', (data: Buffer) => {
          const text = data.toString('utf8');
          socket.emit('data', text);
          if (recordingWriter) recordingWriter.writeOutput(text);
        });

        session.stream.on('close', () => {
          socket.emit('session:closed');
          cleanup(sessionId);
        });

        session.client.on('error', (err) => {
          logger.error('SSH connection error:', err.message);
          socket.emit('session:error', { message: 'Connection failed. Please check your credentials and try again.' });
          cleanup(sessionId);
        });

        if (session.bastionClient) {
          session.bastionClient.on('error', (err) => {
            logger.error('SSH bastion error:', err.message);
            socket.emit('session:error', { message: 'Gateway connection failed. Please check gateway configuration.' });
            cleanup(sessionId);
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Connection failed';
        logSessionError(message);
        socket.emit('session:error', { message: 'Connection failed. Please check your credentials and try again.' });
      }
    });

    socket.on('data', (data: string) => {
      if (currentSession?.stream.writable) {
        currentSession.stream.write(data);
        if (recordingWriter) recordingWriter.writeInput(data);
        // Throttled implicit heartbeat (at most once per 30s)
        const now = Date.now();
        if (now - lastActivityUpdate > 30000) {
          lastActivityUpdate = now;
          sessionService.heartbeatBySocketId(socket.id).catch(() => {});
        }
      }
    });

    // Explicit heartbeat from client
    socket.on('session:heartbeat', () => {
      sessionService.heartbeatBySocketId(socket.id).catch(() => {});
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
          auditService.log({
            userId: user.userId,
            action: 'SFTP_MKDIR',
            targetType: 'Connection',
            targetId: currentConnectionId ?? undefined,
            details: { path: safePath },
            ipAddress: clientIp,
          });
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
          auditService.log({
            userId: user.userId,
            action: 'SFTP_DELETE',
            targetType: 'Connection',
            targetId: currentConnectionId ?? undefined,
            details: { path: safePath, type: 'file' },
            ipAddress: clientIp,
          });
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
          auditService.log({
            userId: user.userId,
            action: 'SFTP_DELETE',
            targetType: 'Connection',
            targetId: currentConnectionId ?? undefined,
            details: { path: safePath, type: 'directory' },
            ipAddress: clientIp,
          });
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
          auditService.log({
            userId: user.userId,
            action: 'SFTP_RENAME',
            targetType: 'Connection',
            targetId: currentConnectionId ?? undefined,
            details: { oldPath: safeOld, newPath: safeNew },
            ipAddress: clientIp,
          });
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
        if (dlpPolicy?.disableUpload) {
          callback?.({ error: 'File upload is disabled by organization policy' });
          return;
        }
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
      const uploadFilename = transfer.filename;
      const uploadBytes = transfer.bytesTransferred;
      writeStream.end(() => {
        auditService.log({
          userId: user.userId,
          action: 'SFTP_UPLOAD',
          targetType: 'Connection',
          targetId: currentConnectionId ?? undefined,
          details: { filename: uploadFilename, bytesTransferred: uploadBytes },
          ipAddress: clientIp,
        });
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
        if (dlpPolicy?.disableDownload) {
          callback?.({ error: 'File download is disabled by organization policy' });
          return;
        }
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
            auditService.log({
              userId: user.userId,
              action: 'SFTP_DOWNLOAD',
              targetType: 'Connection',
              targetId: currentConnectionId ?? undefined,
              details: { filename, path: safePath, totalBytes: stats.size },
              ipAddress: clientIp,
            });
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
      // Finalize recording
      if (recordingWriter && recordingId) {
        try {
          const { fileSize, duration } = recordingWriter.close();
          completeRecording(recordingId, fileSize, duration).catch((err) => {
            logger.error('Failed to complete recording:', err);
          });
        } catch (recErr) {
          logger.error('Failed to close recording writer:', recErr);
          failRecording(recordingId).catch(() => {});
        }
        recordingWriter = null;
        recordingId = null;
      }

      // End persistent session record
      sessionService.endSessionBySocketId(socket.id).catch((err) => {
        logger.error('Failed to end persistent session:', err);
      });

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
