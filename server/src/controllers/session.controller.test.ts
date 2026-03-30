// Mock all external dependencies before imports
vi.mock('../lib/prisma', () => ({
  default: {
    user: { findUnique: vi.fn() },
    tenant: { findUnique: vi.fn() },
    activeSession: { findUnique: vi.fn() },
  },
}));
vi.mock('../services/connection.service', () => ({
  getConnection: vi.fn(),
  getConnectionCredentials: vi.fn(),
}));
vi.mock('../services/domain.service', () => ({
  resolveDomainCredentials: vi.fn(),
}));
vi.mock('../services/rdp.service', () => ({
  buildRdpGuacamoleSettings: vi.fn().mockReturnValue({ hostname: '192.168.1.10', port: '3389' }),
  mergeRdpSettings: vi.fn().mockReturnValue({}),
}));
vi.mock('../services/vnc.service', () => ({
  buildVncGuacamoleSettings: vi.fn().mockReturnValue({ hostname: '192.168.1.10', port: '5900' }),
  mergeVncSettings: vi.fn().mockReturnValue({}),
}));
vi.mock('../utils/dlp', () => ({
  resolveDlpPolicy: vi.fn().mockReturnValue({ dlpDisableCopy: false, dlpDisablePaste: false, dlpDisableDownload: false, dlpDisableUpload: false }),
}));
vi.mock('../services/session.service', () => ({
  closeStaleSessionsForConnection: vi.fn(),
  startSession: vi.fn().mockResolvedValue('session-id-1'),
  heartbeat: vi.fn(),
  endSession: vi.fn(),
  getActiveSessions: vi.fn().mockResolvedValue([]),
  getActiveSessionCount: vi.fn().mockResolvedValue(5),
  getActiveSessionCountByGateway: vi.fn().mockResolvedValue([]),
}));
vi.mock('../services/audit.service', () => ({
  log: vi.fn(),
}));
vi.mock('../services/loadBalancer.service', () => ({
  selectInstance: vi.fn(),
}));
vi.mock('../services/gateway.service', () => ({
  getDefaultGateway: vi.fn(),
}));
vi.mock('../services/tunnel.service', () => ({
  isTunnelConnected: vi.fn(),
  createTcpProxy: vi.fn(),
  closeTcpProxy: vi.fn(),
}));
vi.mock('../services/sessionCleanup.service', () => ({
  forceDisconnectSession: vi.fn(),
}));
vi.mock('../config', () => ({
  config: {
    recordingEnabled: false,
    recordingPath: '/recordings',
    orchestratorGuacdImage: 'guacd:latest',
  },
}));
vi.mock('../services/recording.service', () => ({
  startRecording: vi.fn(),
  buildRecordingPath: vi.fn(),
}));
vi.mock('../services/lateralMovement.service', () => ({
  checkLateralMovement: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock('../services/goTerminalBroker.service', () => ({
  startSshSession: vi.fn(),
}));
vi.mock('../services/goDesktopSession.service', () => ({
  issueDesktopSessionGrant: vi.fn().mockResolvedValue({ token: 'desktop-token-123', sessionId: 'session-id-1' }),
  heartbeatDesktopSession: vi.fn(),
  endDesktopSession: vi.fn(),
}));
vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));
vi.mock('../utils/ip', () => ({
  getClientIp: vi.fn().mockReturnValue('10.0.0.1'),
}));
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  chmod: vi.fn().mockResolvedValue(undefined),
}));

import { Response, NextFunction } from 'express';
import type { AuthRequest } from '../types';
import {
  createRdpSession,
  createVncSession,
  validateSshAccess,
  sshEnd,
  rdpHeartbeat,
  rdpEnd,
  listActiveSessions,
  getSessionCount,
  getSessionCountByGateway,
  terminateSession,
} from './session.controller';
import prisma from '../lib/prisma';
import { getConnection, getConnectionCredentials } from '../services/connection.service';
import { resolveDomainCredentials } from '../services/domain.service';
import { checkLateralMovement } from '../services/lateralMovement.service';
import { startSshSession } from '../services/goTerminalBroker.service';
import { issueDesktopSessionGrant, heartbeatDesktopSession, endDesktopSession } from '../services/goDesktopSession.service';
import * as sessionService from '../services/session.service';
import * as auditService from '../services/audit.service';
import { forceDisconnectSession } from '../services/sessionCleanup.service';
import { getDefaultGateway } from '../services/gateway.service';

// ---- Test helpers ----

function mockAuthRequest(overrides: Record<string, unknown> = {}): AuthRequest {
  return {
    user: { userId: 'user-1', tenantId: 'tenant-1', role: 'ADMIN', tenantRole: 'OWNER' },
    body: {},
    params: {},
    query: {},
    ...overrides,
  } as unknown as AuthRequest;
}

function mockResponse(): Response {
  const res = {
    json: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

function mockNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

const baseConnection = {
  id: 'conn-1',
  host: '192.168.1.10',
  port: 3389,
  type: 'RDP',
  gatewayId: null,
  gateway: null,
  enableDrive: false,
  dlpPolicy: null,
  rdpSettings: null,
  vncSettings: null,
};

// ---- Tests ----

describe('session.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkLateralMovement).mockResolvedValue({ allowed: true } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ rdpDefaults: null } as never);
    vi.mocked(prisma.tenant.findUnique).mockResolvedValue(null);
    vi.mocked(getDefaultGateway).mockResolvedValue({
      id: 'gw-1',
      type: 'GUACD',
      host: 'gateway.local',
      port: 4822,
      isManaged: false,
      lbStrategy: 'ROUND_ROBIN',
      tunnelEnabled: false,
    } as never);
  });

  // ==================== createRdpSession ====================

  describe('createRdpSession', () => {
    it('creates an RDP session with saved credentials', async () => {
      const req = mockAuthRequest({ body: { connectionId: 'conn-1' } });
      const res = mockResponse();
      const next = mockNext();

      vi.mocked(getConnection).mockResolvedValue(baseConnection as never);
      vi.mocked(getConnectionCredentials).mockResolvedValue({
        username: 'admin',
        password: 'pass123',
        domain: undefined,
      } as never);

      await createRdpSession(req, res, next);

      expect(getConnection).toHaveBeenCalledWith('user-1', 'conn-1', 'tenant-1');
      expect(issueDesktopSessionGrant).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'desktop-token-123',
          sessionId: 'session-id-1',
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('creates an RDP session with manual credentials', async () => {
      const req = mockAuthRequest({
        body: { connectionId: 'conn-1', username: 'manual-user', password: 'manual-pass', domain: 'CORP' },
      });
      const res = mockResponse();
      const next = mockNext();

      vi.mocked(getConnection).mockResolvedValue(baseConnection as never);

      await createRdpSession(req, res, next);

      expect(getConnectionCredentials).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalled();
    });

    it('creates an RDP session with domain credentials', async () => {
      const req = mockAuthRequest({
        body: { connectionId: 'conn-1', credentialMode: 'domain' },
      });
      const res = mockResponse();
      const next = mockNext();

      vi.mocked(getConnection).mockResolvedValue(baseConnection as never);
      vi.mocked(resolveDomainCredentials).mockResolvedValue({
        domainUsername: 'corp\\admin',
        password: 'domainpass',
        domainName: 'CORP',
      } as never);

      await createRdpSession(req, res, next);

      expect(resolveDomainCredentials).toHaveBeenCalledWith('user-1');
      expect(res.json).toHaveBeenCalled();
    });

    it('rejects non-RDP connections', async () => {
      const req = mockAuthRequest({ body: { connectionId: 'conn-1' } });
      const res = mockResponse();
      const next = mockNext();

      vi.mocked(getConnection).mockResolvedValue({ ...baseConnection, type: 'SSH' } as never);

      await createRdpSession(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Not an RDP connection', statusCode: 400 }),
      );
    });

    it('rejects SSH key-only credentials for RDP', async () => {
      const req = mockAuthRequest({ body: { connectionId: 'conn-1' } });
      const res = mockResponse();
      const next = mockNext();

      vi.mocked(getConnection).mockResolvedValue(baseConnection as never);
      vi.mocked(getConnectionCredentials).mockResolvedValue({
        username: 'admin',
        password: '',
        privateKey: 'ssh-rsa ...',
      } as never);

      await createRdpSession(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'SSH key authentication is not supported for RDP connections' }),
      );
    });

    it('blocks lateral movement anomalies', async () => {
      const req = mockAuthRequest({ body: { connectionId: 'conn-1' } });
      const res = mockResponse();
      const next = mockNext();

      vi.mocked(checkLateralMovement).mockResolvedValue({
        allowed: false,
        distinctTargets: 15,
        windowMinutes: 5,
        threshold: 10,
      } as never);

      await createRdpSession(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 403 }),
      );
    });

    it('rejects incomplete domain credentials', async () => {
      const req = mockAuthRequest({
        body: { connectionId: 'conn-1', credentialMode: 'domain' },
      });
      const res = mockResponse();
      const next = mockNext();

      vi.mocked(getConnection).mockResolvedValue(baseConnection as never);
      vi.mocked(resolveDomainCredentials).mockResolvedValue({
        domainUsername: '',
        password: '',
      } as never);

      await createRdpSession(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 400 }),
      );
    });

    it('logs audit event on error', async () => {
      const req = mockAuthRequest({ body: { connectionId: 'conn-1' } });
      const res = mockResponse();
      const next = mockNext();

      vi.mocked(getConnection).mockRejectedValue(new Error('DB down'));

      await createRdpSession(req, res, next);

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SESSION_ERROR',
          details: expect.objectContaining({ protocol: 'RDP' }),
        }),
      );
      expect(next).toHaveBeenCalled();
    });
  });

  // ==================== createVncSession ====================

  describe('createVncSession', () => {
    const vncConnection = { ...baseConnection, type: 'VNC', port: 5900 };

    it('creates a VNC session with saved credentials', async () => {
      const req = mockAuthRequest({ body: { connectionId: 'conn-1' } });
      const res = mockResponse();
      const next = mockNext();

      vi.mocked(getConnection).mockResolvedValue(vncConnection as never);
      vi.mocked(getConnectionCredentials).mockResolvedValue({
        username: '',
        password: 'vncpass',
      } as never);

      await createVncSession(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ token: 'desktop-token-123', sessionId: 'session-id-1' }),
      );
    });

    it('creates a VNC session with override password', async () => {
      const req = mockAuthRequest({
        body: { connectionId: 'conn-1', password: 'override-pass' },
      });
      const res = mockResponse();
      const next = mockNext();

      vi.mocked(getConnection).mockResolvedValue(vncConnection as never);

      await createVncSession(req, res, next);

      expect(getConnectionCredentials).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalled();
    });

    it('rejects non-VNC connections', async () => {
      const req = mockAuthRequest({ body: { connectionId: 'conn-1' } });
      const res = mockResponse();
      const next = mockNext();

      vi.mocked(getConnection).mockResolvedValue({ ...vncConnection, type: 'RDP' } as never);

      await createVncSession(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Not a VNC connection', statusCode: 400 }),
      );
    });

    it('blocks lateral movement anomalies', async () => {
      const req = mockAuthRequest({ body: { connectionId: 'conn-1' } });
      const res = mockResponse();
      const next = mockNext();

      vi.mocked(checkLateralMovement).mockResolvedValue({
        allowed: false,
        distinctTargets: 15,
        windowMinutes: 5,
        threshold: 10,
      } as never);

      await createVncSession(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 403 }),
      );
    });

    it('logs audit event on error', async () => {
      const req = mockAuthRequest({ body: { connectionId: 'conn-1' } });
      const res = mockResponse();
      const next = mockNext();

      vi.mocked(getConnection).mockRejectedValue(new Error('DB down'));

      await createVncSession(req, res, next);

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SESSION_ERROR',
          details: expect.objectContaining({ protocol: 'VNC' }),
        }),
      );
    });
  });

  // ==================== validateSshAccess ====================

  describe('validateSshAccess', () => {
    it('issues a terminal-broker SSH session response', async () => {
      const req = mockAuthRequest({ body: { connectionId: 'conn-ssh' } });
      const res = mockResponse();

      vi.mocked(startSshSession).mockResolvedValue({
        transport: 'terminal-broker',
        sessionId: 'ssh-session-1',
        token: 'grant-token',
        expiresAt: '2030-01-01T00:00:00.000Z',
        dlpPolicy: {
          disableCopy: false,
          disablePaste: false,
          disableDownload: false,
          disableUpload: false,
        },
        enforcedSshSettings: null,
        sftpSupported: false,
      } as never);

      await validateSshAccess(req, res);

      expect(startSshSession).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user-1',
        connectionId: 'conn-ssh',
      }));
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        transport: 'terminal-broker',
        sessionId: 'ssh-session-1',
        token: 'grant-token',
        webSocketPath: '/ws/terminal',
      }));
    });

    it('returns legacy transport for tunnel-backed SSH sessions', async () => {
      const req = mockAuthRequest({ body: { connectionId: 'conn-1' } });
      const res = mockResponse();

      vi.mocked(startSshSession).mockResolvedValue({
        transport: 'legacy-socketio',
        connectionId: 'conn-1',
        dlpPolicy: {
          disableCopy: false,
          disablePaste: false,
          disableDownload: false,
          disableUpload: false,
        },
        enforcedSshSettings: null,
        sftpSupported: true,
        reason: 'tunnel_gateway',
      } as never);

      await validateSshAccess(req, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        transport: 'legacy-socketio',
        connectionId: 'conn-1',
      }));
    });

    it('rejects lateral movement anomalies before SSH grant issuance', async () => {
      const req = mockAuthRequest({ body: { connectionId: 'conn-1' } });
      const res = mockResponse();

      vi.mocked(checkLateralMovement).mockResolvedValueOnce({
        allowed: false,
        distinctTargets: 15,
        windowMinutes: 5,
        threshold: 10,
      } as never);

      await expect(validateSshAccess(req, res)).rejects.toThrow('Session denied: anomalous lateral movement detected.');
      expect(startSshSession).not.toHaveBeenCalled();
    });
  });

  describe('sshEnd', () => {
    it('ends an owned SSH session', async () => {
      const req = mockAuthRequest({ params: { sessionId: 'ssh-sess-1' } });
      const res = mockResponse();

      vi.mocked(prisma.activeSession.findUnique).mockResolvedValue({
        id: 'ssh-sess-1',
        userId: 'user-1',
      } as never);

      await sshEnd(req, res);

      expect(sessionService.endSession).toHaveBeenCalledWith('ssh-sess-1', 'client_disconnect');
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    it('rejects ending a session owned by another user', async () => {
      const req = mockAuthRequest({ params: { sessionId: 'ssh-sess-1' } });
      const res = mockResponse();

      vi.mocked(prisma.activeSession.findUnique).mockResolvedValue({
        id: 'ssh-sess-1',
        userId: 'other-user',
      } as never);

      await expect(sshEnd(req, res)).rejects.toThrow('Session not found');
    });
  });

  // ==================== rdpHeartbeat ====================

  describe('rdpHeartbeat', () => {
    it('sends heartbeat for an active session', async () => {
      const req = mockAuthRequest({ params: { sessionId: 'sess-1' } });
      const res = mockResponse();

      vi.mocked(prisma.activeSession.findUnique).mockResolvedValue({
        id: 'sess-1',
        userId: 'user-1',
        status: 'ACTIVE',
      } as never);

      await rdpHeartbeat(req, res);

      expect(heartbeatDesktopSession).toHaveBeenCalledWith('sess-1', 'user-1');
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    it('returns 404 for non-existent session', async () => {
      const req = mockAuthRequest({ params: { sessionId: 'sess-nope' } });
      const res = mockResponse();

      vi.mocked(heartbeatDesktopSession).mockRejectedValueOnce(new Error('Session not found'));

      await expect(rdpHeartbeat(req, res)).rejects.toThrow('Session not found');
    });

    it('returns 404 when session belongs to different user', async () => {
      const req = mockAuthRequest({ params: { sessionId: 'sess-1' } });
      const res = mockResponse();

      vi.mocked(heartbeatDesktopSession).mockRejectedValueOnce(new Error('Session not found'));

      await expect(rdpHeartbeat(req, res)).rejects.toThrow('Session not found');
    });

    it('returns 410 for closed session', async () => {
      const req = mockAuthRequest({ params: { sessionId: 'sess-1' } });
      const res = mockResponse();

      vi.mocked(heartbeatDesktopSession).mockRejectedValueOnce(new Error('Session already closed'));

      await expect(rdpHeartbeat(req, res)).rejects.toThrow('Session already closed');
    });
  });

  // ==================== rdpEnd ====================

  describe('rdpEnd', () => {
    it('ends an active session', async () => {
      const req = mockAuthRequest({ params: { sessionId: 'sess-1' } });
      const res = mockResponse();

      vi.mocked(prisma.activeSession.findUnique).mockResolvedValue({
        id: 'sess-1',
        userId: 'user-1',
      } as never);

      await rdpEnd(req, res);

      expect(endDesktopSession).toHaveBeenCalledWith('sess-1', 'user-1', 'client_disconnect');
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    it('returns 404 for non-existent session', async () => {
      const req = mockAuthRequest({ params: { sessionId: 'sess-nope' } });
      const res = mockResponse();

      vi.mocked(endDesktopSession).mockRejectedValueOnce(new Error('Session not found'));

      await expect(rdpEnd(req, res)).rejects.toThrow('Session not found');
    });
  });

  // ==================== listActiveSessions ====================

  describe('listActiveSessions', () => {
    it('returns active sessions without filters', async () => {
      const req = mockAuthRequest({ query: {} });
      const res = mockResponse();

      await listActiveSessions(req, res);

      expect(sessionService.getActiveSessions).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        protocol: undefined,
        gatewayId: undefined,
      });
      expect(res.json).toHaveBeenCalledWith([]);
    });

    it('filters by protocol', async () => {
      const req = mockAuthRequest({ query: { protocol: 'SSH' } });
      const res = mockResponse();

      await listActiveSessions(req, res);

      expect(sessionService.getActiveSessions).toHaveBeenCalledWith(
        expect.objectContaining({ protocol: 'SSH' }),
      );
    });

    it('filters by gatewayId', async () => {
      const req = mockAuthRequest({ query: { gatewayId: 'gw-1' } });
      const res = mockResponse();

      await listActiveSessions(req, res);

      expect(sessionService.getActiveSessions).toHaveBeenCalledWith(
        expect.objectContaining({ gatewayId: 'gw-1' }),
      );
    });

    it('ignores unknown protocol values', async () => {
      const req = mockAuthRequest({ query: { protocol: 'TELNET' } });
      const res = mockResponse();

      await listActiveSessions(req, res);

      expect(sessionService.getActiveSessions).toHaveBeenCalledWith(
        expect.objectContaining({ protocol: undefined }),
      );
    });
  });

  // ==================== getSessionCount ====================

  describe('getSessionCount', () => {
    it('returns session count for tenant', async () => {
      const req = mockAuthRequest();
      const res = mockResponse();

      await getSessionCount(req, res);

      expect(sessionService.getActiveSessionCount).toHaveBeenCalledWith({ tenantId: 'tenant-1' });
      expect(res.json).toHaveBeenCalledWith({ count: 5 });
    });
  });

  // ==================== getSessionCountByGateway ====================

  describe('getSessionCountByGateway', () => {
    it('returns counts grouped by gateway', async () => {
      const req = mockAuthRequest();
      const res = mockResponse();

      await getSessionCountByGateway(req, res);

      expect(sessionService.getActiveSessionCountByGateway).toHaveBeenCalledWith('tenant-1');
      expect(res.json).toHaveBeenCalled();
    });
  });

  // ==================== terminateSession ====================

  describe('terminateSession', () => {
    it('terminates a session and force-disconnects transport', async () => {
      const req = mockAuthRequest({ params: { sessionId: 'sess-1' } });
      const res = mockResponse();

      vi.mocked(prisma.activeSession.findUnique).mockResolvedValue({
        id: 'sess-1',
        userId: 'target-user',
        protocol: 'RDP',
        socketId: 'sock-1',
        connectionId: 'conn-1',
        user: { tenantMemberships: [{ tenantId: 'tenant-1' }] },
      } as never);

      await terminateSession(req, res);

      expect(sessionService.endSession).toHaveBeenCalledWith('sess-1', 'admin_terminated');
      expect(forceDisconnectSession).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sess-1', protocol: 'RDP' }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SESSION_TERMINATE',
          targetId: 'sess-1',
        }),
      );
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    it('returns 404 when session not found', async () => {
      const req = mockAuthRequest({ params: { sessionId: 'sess-nope' } });
      const res = mockResponse();

      vi.mocked(prisma.activeSession.findUnique).mockResolvedValue(null);

      await expect(terminateSession(req, res)).rejects.toThrow('Session not found');
    });

    it('returns 404 when session belongs to different tenant', async () => {
      const req = mockAuthRequest({ params: { sessionId: 'sess-1' } });
      const res = mockResponse();

      vi.mocked(prisma.activeSession.findUnique).mockResolvedValue({
        id: 'sess-1',
        userId: 'target-user',
        user: { tenantMemberships: [{ tenantId: 'other-tenant' }] },
      } as never);

      await expect(terminateSession(req, res)).rejects.toThrow('Session not found');
    });
  });
});
