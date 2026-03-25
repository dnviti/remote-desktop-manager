import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import net from 'net';
import { MsgType, buildFrame, parseFrame, HEADER_SIZE } from './protocol';
import { buildWsOptions } from './auth';
import type { TunnelConfig } from './config';
import {
  handleOpenFrame,
  handleDataFrame,
  handleCloseFrame,
  destroyAllSockets,
  activeStreamCount,
} from './tcpForwarder';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<TunnelConfig> = {}): TunnelConfig {
  return {
    serverUrl: 'wss://example.com/tunnel',
    token: 'test-token-secret-value',
    gatewayId: 'gw-001',
    agentVersion: '1.0.0',
    pingIntervalMs: 15000,
    reconnectInitialMs: 1000,
    reconnectMaxMs: 60000,
    localServiceHost: 'localhost',
    localServicePort: 4822,
    ...overrides,
  };
}

function mockWs(readyState = 1) {
  return {
    readyState,
    send: vi.fn(),
    close: vi.fn(),
  } as unknown as import('ws').WebSocket;
}

function mockSocket() {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  const socket = {
    destroyed: false,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
      return socket;
    }),
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
      return socket;
    }),
    write: vi.fn(),
    destroy: vi.fn(() => { socket.destroyed = true; }),
    _emit(event: string, ...args: unknown[]) {
      for (const h of handlers[event] ?? []) h(...args);
    },
  };
  return socket;
}

// ===========================================================================
// SSRF Prevention (comprehensive, per OWASP SSRF Bible)
// ===========================================================================

describe('SSRF Prevention', () => {
  let connectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const fakeSocket = mockSocket();
    connectSpy = vi.spyOn(net, 'connect').mockReturnValue(fakeSocket as unknown as net.Socket);
  });

  afterEach(() => {
    destroyAllSockets();
    connectSpy.mockRestore();
  });

  // 1. AWS metadata endpoint
  it('rejects AWS metadata endpoint (169.254.169.254)', () => {
    const ws = mockWs();
    handleOpenFrame(ws, 1, Buffer.from('169.254.169.254:80', 'utf8'));
    expect(connectSpy).not.toHaveBeenCalled();
    const sentFrame = (ws.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Buffer | undefined;
    if (sentFrame) {
      expect(sentFrame[0]).toBe(MsgType.CLOSE);
    }
  });

  // 2. Azure metadata (same IP, explicit port)
  it('rejects Azure metadata endpoint (169.254.169.254:80)', () => {
    const ws = mockWs();
    handleOpenFrame(ws, 2, Buffer.from('169.254.169.254:80', 'utf8'));
    expect(connectSpy).not.toHaveBeenCalled();
  });

  // 3. GCP metadata (DNS-based)
  it('rejects GCP metadata (metadata.google.internal)', () => {
    const ws = mockWs();
    handleOpenFrame(ws, 3, Buffer.from('metadata.google.internal:80', 'utf8'));
    expect(connectSpy).not.toHaveBeenCalled();
  });

  // 4. IPv6-mapped cloud metadata addresses
  it('rejects cloud metadata via IPv6 mapped address [::ffff:169.254.169.254]', () => {
    const ws = mockWs();
    handleOpenFrame(ws, 4, Buffer.from('::ffff:169.254.169.254:80', 'utf8'));
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('rejects cloud metadata via full IPv6 mapped address [0:0:0:0:0:ffff:a9fe:a9fe]', () => {
    const ws = mockWs();
    handleOpenFrame(ws, 5, Buffer.from('0:0:0:0:0:ffff:a9fe:a9fe:80', 'utf8'));
    expect(connectSpy).not.toHaveBeenCalled();
  });

  // 5. URL-encoded targets
  it('rejects URL-encoded 127.0.0.1 (127%2e0%2e0%2e1)', () => {
    const ws = mockWs();
    handleOpenFrame(ws, 6, Buffer.from('127%2e0%2e0%2e1:22', 'utf8'));
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('rejects URL-encoded localhost with null byte (localhost%00@evil.com)', () => {
    const ws = mockWs();
    handleOpenFrame(ws, 7, Buffer.from('localhost%00@evil.com:22', 'utf8'));
    expect(connectSpy).not.toHaveBeenCalled();
  });

  // 6. Decimal IP notation
  it('rejects decimal IP notation for 127.0.0.1 (2130706433)', () => {
    const ws = mockWs();
    handleOpenFrame(ws, 8, Buffer.from('2130706433:22', 'utf8'));
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('rejects hex IP notation for 127.0.0.1 (0x7f000001)', () => {
    const ws = mockWs();
    handleOpenFrame(ws, 9, Buffer.from('0x7f000001:22', 'utf8'));
    expect(connectSpy).not.toHaveBeenCalled();
  });

  // 7. Zero-prefixed octets (octal)
  it('rejects octal notation for 127.0.0.1 (0177.0.0.1)', () => {
    const ws = mockWs();
    handleOpenFrame(ws, 10, Buffer.from('0177.0.0.1:22', 'utf8'));
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('rejects hex-octet notation (0x7f.0.0.1)', () => {
    const ws = mockWs();
    handleOpenFrame(ws, 11, Buffer.from('0x7f.0.0.1:22', 'utf8'));
    expect(connectSpy).not.toHaveBeenCalled();
  });

  // 8. localhost case variations
  it('rejects LOCALHOST (uppercase)', () => {
    const ws = mockWs();
    handleOpenFrame(ws, 12, Buffer.from('LOCALHOST:22', 'utf8'));
    // If ALLOWED_HOSTS is case-sensitive, uppercase LOCALHOST would be rejected.
    // The current implementation only allows lowercase 'localhost'.
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('rejects Localhost (mixed case)', () => {
    const ws = mockWs();
    handleOpenFrame(ws, 13, Buffer.from('Localhost:22', 'utf8'));
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('rejects localHost (camelCase)', () => {
    const ws = mockWs();
    handleOpenFrame(ws, 14, Buffer.from('localHost:22', 'utf8'));
    expect(connectSpy).not.toHaveBeenCalled();
  });

  // Additional SSRF vectors
  it('rejects 10.0.0.0/8 private range', () => {
    const ws = mockWs();
    handleOpenFrame(ws, 15, Buffer.from('10.0.0.1:22', 'utf8'));
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('rejects 172.16.0.0/12 private range', () => {
    const ws = mockWs();
    handleOpenFrame(ws, 16, Buffer.from('172.16.0.1:22', 'utf8'));
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('rejects 192.168.0.0/16 private range', () => {
    const ws = mockWs();
    handleOpenFrame(ws, 17, Buffer.from('192.168.1.1:22', 'utf8'));
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('rejects [::] IPv6 wildcard', () => {
    const ws = mockWs();
    handleOpenFrame(ws, 18, Buffer.from('[::]:22', 'utf8'));
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('rejects 0.0.0.0', () => {
    const ws = mockWs();
    handleOpenFrame(ws, 19, Buffer.from('0.0.0.0:22', 'utf8'));
    expect(connectSpy).not.toHaveBeenCalled();
  });

  // Confirm legitimate targets still work
  it('allows localhost', () => {
    const ws = mockWs();
    handleOpenFrame(ws, 100, Buffer.from('localhost:4822', 'utf8'));
    expect(connectSpy).toHaveBeenCalledWith(4822, 'localhost');
  });

  it('allows 127.0.0.1', () => {
    const ws = mockWs();
    handleOpenFrame(ws, 101, Buffer.from('127.0.0.1:3389', 'utf8'));
    expect(connectSpy).toHaveBeenCalledWith(3389, '127.0.0.1');
  });

  it('allows ::1', () => {
    const ws = mockWs();
    handleOpenFrame(ws, 102, Buffer.from('::1:5900', 'utf8'));
    expect(connectSpy).toHaveBeenCalledWith(5900, '::1');
  });
});

// ===========================================================================
// WebSocket Security
// ===========================================================================

describe('WebSocket Security', () => {
  // 9. Token not exposed in WebSocket URL
  it('does not include token in WebSocket URL query string', () => {
    const cfg = makeConfig({ token: 'super-secret-token-xyz' });
    const opts = buildWsOptions(cfg);

    // The serverUrl should NOT have the token appended
    // buildWsOptions returns options, not a URL — verify token is only in headers
    const headers = opts.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer super-secret-token-xyz');

    // Verify no query-string-like token in any option value
    const optStr = JSON.stringify(opts);
    // Token should only appear in the Authorization header value, not in any URL field
    const tokenOccurrences = optStr.split('super-secret-token-xyz').length - 1;
    expect(tokenOccurrences).toBe(1); // exactly once, in the header
  });

  // 10. Auth headers present on every reconnection
  it('produces consistent auth headers across multiple calls (reconnection safety)', () => {
    const cfg = makeConfig({ token: 'reconnect-token' });

    // Simulate what happens on reconnect: buildWsOptions is called again
    const opts1 = buildWsOptions(cfg);
    const opts2 = buildWsOptions(cfg);
    const opts3 = buildWsOptions(cfg);

    const h1 = opts1.headers as Record<string, string>;
    const h2 = opts2.headers as Record<string, string>;
    const h3 = opts3.headers as Record<string, string>;

    expect(h1.Authorization).toBe('Bearer reconnect-token');
    expect(h2.Authorization).toBe('Bearer reconnect-token');
    expect(h3.Authorization).toBe('Bearer reconnect-token');

    expect(h1['X-Gateway-Id']).toBe(cfg.gatewayId);
    expect(h2['X-Gateway-Id']).toBe(cfg.gatewayId);
    expect(h3['X-Gateway-Id']).toBe(cfg.gatewayId);
  });

  // 11. Gateway ID header prevents cross-tenant access
  it('always includes X-Gateway-Id header', () => {
    const cfg = makeConfig({ gatewayId: 'tenant-specific-gw-42' });
    const opts = buildWsOptions(cfg);
    const headers = opts.headers as Record<string, string>;
    expect(headers['X-Gateway-Id']).toBe('tenant-specific-gw-42');
    expect(headers['X-Gateway-Id']).toBeTruthy();
  });

  it('X-Gateway-Id is never empty when config has a value', () => {
    const cfg = makeConfig({ gatewayId: 'gw-nonempty' });
    const opts = buildWsOptions(cfg);
    const headers = opts.headers as Record<string, string>;
    expect(headers['X-Gateway-Id'].length).toBeGreaterThan(0);
  });

  // 12. Handles malicious binary frames without crashing
  it('handles 50 random binary frames without crashing', () => {
    for (let i = 0; i < 50; i++) {
      const len = Math.floor(Math.random() * 1000) + 1;
      const buf = Buffer.alloc(len);
      for (let j = 0; j < len; j++) {
        buf[j] = Math.floor(Math.random() * 256);
      }

      // parseFrame should return null or a valid frame, never throw
      const result = parseFrame(buf);
      if (result !== null) {
        // If it parsed, the fields should be defined
        expect(typeof result.type).toBe('number');
        expect(typeof result.streamId).toBe('number');
        expect(Buffer.isBuffer(result.payload)).toBe(true);
      }
    }
  });

  it('handles empty buffer without crashing', () => {
    expect(parseFrame(Buffer.alloc(0))).toBeNull();
  });

  it('handles buffer of exactly HEADER_SIZE with no payload', () => {
    const buf = Buffer.alloc(HEADER_SIZE);
    buf[0] = 255; // invalid type
    const result = parseFrame(buf);
    expect(result).not.toBeNull();
    expect(result!.payload.length).toBe(0);
  });
});

// ===========================================================================
// Credential & Token Security
// ===========================================================================

describe('Credential & Token Security', () => {
  let connectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const fakeSocket = mockSocket();
    connectSpy = vi.spyOn(net, 'connect').mockReturnValue(fakeSocket as unknown as net.Socket);
  });

  afterEach(() => {
    destroyAllSockets();
    connectSpy.mockRestore();
  });

  // 13. Token not logged on connection failure
  it('does not include token in stderr/stdout on connection error', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    try {
      // Trigger an OPEN frame to a rejected host (will generate a warn log)
      const ws = mockWs();
      handleOpenFrame(ws, 1, Buffer.from('evil.com:22', 'utf8'));

      // Check all stderr/stdout output for token leakage
      const allStderrOutput = stderrSpy.mock.calls.map(c => String(c[0])).join('');
      const allStdoutOutput = stdoutSpy.mock.calls.map(c => String(c[0])).join('');

      // The token value should never appear in log output
      expect(allStderrOutput).not.toContain('test-token-secret-value');
      expect(allStdoutOutput).not.toContain('test-token-secret-value');
    } finally {
      stderrSpy.mockRestore();
      stdoutSpy.mockRestore();
    }
  });

  // 14. TLS certificate paths not logged
  it('does not include certificate content in buildWsOptions output beyond the options object', () => {
    const cfg = makeConfig({
      caCert: '-----BEGIN CERTIFICATE-----\nSECRET_CA_DATA\n-----END CERTIFICATE-----',
      clientCert: '-----BEGIN CERTIFICATE-----\nSECRET_CLIENT_DATA\n-----END CERTIFICATE-----',
      clientKey: '-----BEGIN PRIVATE KEY-----\nSECRET_KEY_DATA\n-----END PRIVATE KEY-----',
    });

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    try {
      buildWsOptions(cfg);

      // No TLS material should be logged
      const allOutput = [
        ...stderrSpy.mock.calls.map(c => String(c[0])),
        ...stdoutSpy.mock.calls.map(c => String(c[0])),
      ].join('');

      expect(allOutput).not.toContain('SECRET_CA_DATA');
      expect(allOutput).not.toContain('SECRET_CLIENT_DATA');
      expect(allOutput).not.toContain('SECRET_KEY_DATA');
      expect(allOutput).not.toContain('PRIVATE KEY');
    } finally {
      stderrSpy.mockRestore();
      stdoutSpy.mockRestore();
    }
  });
});

// ===========================================================================
// Frame Injection
// ===========================================================================

describe('Frame Injection', () => {
  let connectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const fakeSocket = mockSocket();
    connectSpy = vi.spyOn(net, 'connect').mockReturnValue(fakeSocket as unknown as net.Socket);
  });

  afterEach(() => {
    destroyAllSockets();
    connectSpy.mockRestore();
  });

  // 15. Rejects frames with spoofed stream IDs
  it('ignores DATA for stream ID 0 (never opened)', () => {
    // Stream ID 0 is never explicitly opened by the client
    handleDataFrame(0, Buffer.from('malicious data'));
    // Should not throw, and no socket should exist for stream 0
    expect(activeStreamCount()).toBe(0);
  });

  it('ignores DATA for stream ID that was never opened', () => {
    handleDataFrame(12345, Buffer.from('spoofed data'));
    expect(activeStreamCount()).toBe(0);
  });

  it('ignores CLOSE for stream ID that was never opened', () => {
    const ws = mockWs();
    handleCloseFrame(ws, 99999);
    expect(activeStreamCount()).toBe(0);
  });

  it('ignores DATA for a stream after it has been closed', () => {
    const ws = mockWs();
    const fakeSocket = mockSocket();
    connectSpy.mockReturnValueOnce(fakeSocket as unknown as net.Socket);

    handleOpenFrame(ws, 500, Buffer.from('localhost:4822', 'utf8'));
    fakeSocket._emit('connect');
    expect(activeStreamCount()).toBe(1);

    // Close the stream
    handleCloseFrame(ws, 500);
    expect(activeStreamCount()).toBe(0);

    // Try to send data to the closed stream — should be ignored
    handleDataFrame(500, Buffer.from('data after close'));
    expect(activeStreamCount()).toBe(0);
  });

  // 16. Handles oversized frames
  it('parseFrame handles frame with payload indication of 100MB without allocating 100MB', () => {
    // Build a frame that claims to have a huge payload but actually only has 4 bytes
    const buf = Buffer.alloc(HEADER_SIZE + 4); // tiny buffer
    buf[0] = MsgType.DATA;
    buf[1] = 0;
    buf.writeUInt16BE(1, 2);
    // The frame format doesn't include a payload length field — payload is
    // everything after the header. So a "100MB indication" would mean a
    // 100MB buffer. We test that parseFrame only returns what's actually there.
    const result = parseFrame(buf);
    expect(result).not.toBeNull();
    expect(result!.payload.length).toBe(4); // only actual bytes, not some inflated count
  });

  it('buildFrame with very large payload does not corrupt header', () => {
    // 1MB payload
    const bigPayload = Buffer.alloc(1024 * 1024, 0xAB);
    const frame = buildFrame(MsgType.DATA, 42, bigPayload);
    expect(frame.length).toBe(HEADER_SIZE + bigPayload.length);
    expect(frame[0]).toBe(MsgType.DATA);
    expect(frame.readUInt16BE(2)).toBe(42);
    // Verify payload integrity at boundaries
    expect(frame[HEADER_SIZE]).toBe(0xAB);
    expect(frame[frame.length - 1]).toBe(0xAB);
  });
});

// ===========================================================================
// Denial of Service
// ===========================================================================

describe('Denial of Service', () => {
  // 17. Rapid frame flood
  it('handles 100,000 tiny parseFrame calls without memory issues', () => {
    const startMem = process.memoryUsage().heapUsed;

    for (let i = 0; i < 100_000; i++) {
      const frame = buildFrame(MsgType.DATA, i % 65536, Buffer.from('x'));
      const parsed = parseFrame(frame);
      expect(parsed).not.toBeNull();
    }

    const endMem = process.memoryUsage().heapUsed;
    const memGrowthMB = (endMem - startMem) / (1024 * 1024);
    // Should not grow by more than 50MB for 100K tiny frames
    expect(memGrowthMB).toBeLessThan(50);
  });

  it('handles rapid DATA frames for non-existent streams without crash', () => {
    for (let i = 0; i < 10_000; i++) {
      // Sending DATA to non-existent streams should be no-ops
      handleDataFrame(i, Buffer.from(`flood-${i}`));
    }
    // Should not have created any active streams
    expect(activeStreamCount()).toBe(0);
  });

  // 18. Connection limit enforcement (stream ID space)
  it('streamId wraps at uint16 max (65535) in protocol encoding', () => {
    // The protocol uses uint16 for stream IDs, so max is 65535
    const frame = buildFrame(MsgType.OPEN, 65535, Buffer.from('localhost:22'));
    const parsed = parseFrame(frame);
    expect(parsed!.streamId).toBe(65535);
  });

  it('streamId 0 is valid in protocol encoding', () => {
    const frame = buildFrame(MsgType.OPEN, 0);
    const parsed = parseFrame(frame);
    expect(parsed!.streamId).toBe(0);
  });

  it('very large streamId values are rejected by protocol encoding', () => {
    // Values > 65535 exceed uint16 range — writeUInt16BE throws RangeError
    expect(() => buildFrame(MsgType.DATA, 65536 as number)).toThrow(RangeError);
    expect(() => buildFrame(MsgType.DATA, 100000 as number)).toThrow(RangeError);
    expect(() => buildFrame(MsgType.DATA, -1 as number)).toThrow(RangeError);
  });
});

// ===========================================================================
// Protocol edge cases with security implications
// ===========================================================================

describe('Protocol security edge cases', () => {
  it('parseFrame with type byte set to 0 (undefined type)', () => {
    const buf = Buffer.alloc(HEADER_SIZE);
    buf[0] = 0; // no defined message type for 0
    const result = parseFrame(buf);
    expect(result).not.toBeNull();
    expect(result!.type).toBe(0);
    // The caller (handleMessage in tunnel.ts) should handle unknown types
    // via the default case in the switch statement
  });

  it('parseFrame with type byte set to 255 (max undefined type)', () => {
    const buf = Buffer.alloc(HEADER_SIZE + 10);
    buf[0] = 255;
    const result = parseFrame(buf);
    expect(result).not.toBeNull();
    expect(result!.type).toBe(255);
  });

  it('flags byte (byte 1) is always 0 in buildFrame output', () => {
    for (const type of [MsgType.OPEN, MsgType.DATA, MsgType.CLOSE, MsgType.PING, MsgType.PONG]) {
      const frame = buildFrame(type, 1, Buffer.from('test'));
      expect(frame[1]).toBe(0);
    }
  });

  it('payload with embedded frame headers is not re-interpreted', () => {
    // Build a payload that looks like another frame header
    const fakeHeader = Buffer.alloc(HEADER_SIZE);
    fakeHeader[0] = MsgType.CLOSE;
    fakeHeader.writeUInt16BE(999, 2);

    const frame = buildFrame(MsgType.DATA, 1, fakeHeader);
    const parsed = parseFrame(frame);

    // The outer frame should be DATA with stream 1
    expect(parsed!.type).toBe(MsgType.DATA);
    expect(parsed!.streamId).toBe(1);
    // The "fake header" should be treated as opaque payload data
    expect(parsed!.payload.length).toBe(HEADER_SIZE);
    expect(parsed!.payload[0]).toBe(MsgType.CLOSE);
  });
});

// ===========================================================================
// Authentication header completeness
// ===========================================================================

describe('Authentication header completeness', () => {
  it('all three required headers are always present', () => {
    const cfg = makeConfig();
    const opts = buildWsOptions(cfg);
    const headers = opts.headers as Record<string, string>;

    expect(headers).toHaveProperty('Authorization');
    expect(headers).toHaveProperty('X-Gateway-Id');
    expect(headers).toHaveProperty('X-Agent-Version');
  });

  it('Bearer prefix is always present in Authorization', () => {
    const cfg = makeConfig({ token: '' });
    const opts = buildWsOptions(cfg);
    const headers = opts.headers as Record<string, string>;
    // Even with empty token, format is "Bearer "
    expect(headers.Authorization).toMatch(/^Bearer /);
  });

  it('handshakeTimeout is always set (prevents indefinite hang)', () => {
    const cfg = makeConfig();
    const opts = buildWsOptions(cfg);
    expect(opts.handshakeTimeout).toBe(10_000);
    expect(opts.handshakeTimeout).toBeGreaterThan(0);
  });
});
