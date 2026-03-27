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
  generateGuacamoleToken: vi.fn().mockReturnValue('rdp-token-123'),
  mergeRdpSettings: vi.fn().mockReturnValue({}),
}));
vi.mock('../services/vnc.service', () => ({
  generateVncGuacamoleToken: vi.fn().mockReturnValue('vnc-token-123'),
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
      expect(sessionService.closeStaleSessionsForConnection).toHaveBeenCalledWith('user-1', 'conn-1', 'RDP');
      expect(sessionService.startSession).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'rdp-token-123',
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
        expect.objectContaining({ token: 'vnc-token-123', sessionId: 'session-id-1' }),
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
    it('validates SSH access and returns connectionId', async () => {
      const req = mockAuthRequest({ body: { connectionId: 'conn-ssh' } });
      const res = mockResponse();

      vi.mocked(getConnection).mockResolvedValue({ ...baseConnection, type: 'SSH', id: 'conn-ssh' } as never);

      await validateSshAccess(req, res);

      expect(res.json).toHaveBeenCalledWith({ connectionId: 'conn-ssh', type: 'SSH' });
    });

    it('rejects non-SSH connections', async () => {
      const req = mockAuthRequest({ body: { connectionId: 'conn-1' } });
      const res = mockResponse();

      vi.mocked(getConnection).mockResolvedValue(baseConnection as never);

      await expect(validateSshAccess(req, res)).rejects.toThrow('Not an SSH connection');
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

      expect(sessionService.heartbeat).toHaveBeenCalledWith('sess-1');
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    it('returns 404 for non-existent session', async () => {
      const req = mockAuthRequest({ params: { sessionId: 'sess-nope' } });
      const res = mockResponse();

      vi.mocked(prisma.activeSession.findUnique).mockResolvedValue(null);

      await expect(rdpHeartbeat(req, res)).rejects.toThrow('Session not found');
    });

    it('returns 404 when session belongs to different user', async () => {
      const req = mockAuthRequest({ params: { sessionId: 'sess-1' } });
      const res = mockResponse();

      vi.mocked(prisma.activeSession.findUnique).mockResolvedValue({
        id: 'sess-1',
        userId: 'other-user',
        status: 'ACTIVE',
      } as never);

      await expect(rdpHeartbeat(req, res)).rejects.toThrow('Session not found');
    });

    it('returns 410 for closed session', async () => {
      const req = mockAuthRequest({ params: { sessionId: 'sess-1' } });
      const res = mockResponse();

      vi.mocked(prisma.activeSession.findUnique).mockResolvedValue({
        id: 'sess-1',
        userId: 'user-1',
        status: 'CLOSED',
      } as never);

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

      expect(sessionService.endSession).toHaveBeenCalledWith('sess-1', 'client_disconnect');
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    it('returns 404 for non-existent session', async () => {
      const req = mockAuthRequest({ params: { sessionId: 'sess-nope' } });
      const res = mockResponse();

      vi.mocked(prisma.activeSession.findUnique).mockResolvedValue(null);

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
