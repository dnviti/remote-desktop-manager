import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { AuthPayload } from '../types';
import { createSshConnection, resizeSshTerminal, SshSession } from '../services/ssh.service';
import { getConnectionCredentials } from '../services/connection.service';
import { getConnection } from '../services/connection.service';

const activeSessions = new Map<string, SshSession>();

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

    socket.on('session:start', async (data: { connectionId: string }) => {
      try {
        const conn = await getConnection(user.userId, data.connectionId);
        if (conn.type !== 'SSH') {
          socket.emit('session:error', { message: 'Not an SSH connection' });
          return;
        }

        const creds = await getConnectionCredentials(user.userId, data.connectionId);

        const session = await createSshConnection({
          host: conn.host,
          port: conn.port,
          username: creds.username,
          password: creds.password,
        });

        currentSession = session;
        const sessionId = `${user.userId}:${socket.id}`;
        activeSessions.set(sessionId, session);

        socket.emit('session:ready');

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

    socket.on('disconnect', () => {
      const sessionId = `${user.userId}:${socket.id}`;
      cleanup(sessionId);
    });

    function cleanup(sessionId: string) {
      const session = activeSessions.get(sessionId);
      if (session) {
        session.stream.close();
        session.client.end();
        activeSessions.delete(sessionId);
      }
      currentSession = null;
    }
  });
}
