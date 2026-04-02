/**
 * Resilience tests — production failure scenarios for the tunnel-agent.
 *
 * These tests verify that the agent handles real-world edge cases:
 * connection failures, protocol abuse, SSRF attempts, concurrent load,
 * and graceful shutdown under pressure.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import net from 'net';
import type { TunnelConfig } from './config';
import { MsgType, buildFrame } from './protocol';
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
    token: 'test-token',
    gatewayId: 'gw-001',
    agentVersion: '1.0.0',
    pingIntervalMs: 15_000,
    reconnectInitialMs: 1_000,
    reconnectMaxMs: 60_000,
    localServiceHost: 'localhost',
    localServicePort: 4822,
    ...overrides,
  };
}

/** Minimal mock WebSocket */
function mockWs(readyState = 1) {
  return {
    readyState,
    send: vi.fn(),
    close: vi.fn(),
  } as unknown as import('ws').WebSocket;
}

/** Mock socket with EventEmitter-like interface */
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
    write: vi.fn(() => true),
    destroy: vi.fn(() => { socket.destroyed = true; }),
    _emit(event: string, ...args: unknown[]) {
      for (const h of handlers[event] ?? []) h(...args);
    },
  };
  return socket;
}

// ---------------------------------------------------------------------------
// Mock ws module — must be defined before importing TunnelAgent
// ---------------------------------------------------------------------------

let mockWsInstance: {
  readyState: number;
  on: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

function resetMockWsInstance() {
  mockWsInstance = {
    readyState: 1,
    on: vi.fn(),
    send: vi.fn(),
    close: vi.fn(),
  };
}

resetMockWsInstance();

vi.mock('ws', () => {
  function MockWebSocket() {
    return mockWsInstance;
  }
  MockWebSocket.OPEN = 1;
  MockWebSocket.CLOSED = 3;
  return { default: MockWebSocket, WebSocket: MockWebSocket };
});

vi.mock('./tcpForwarder', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tcpForwarder')>();
  return {
    ...actual,
    // Keep real implementations — we only mock for the TunnelAgent-level tests
    // that need to isolate, and use real ones for TCP forwarder tests
  };
});

// Unmock tcpForwarder for the sections that test it directly
vi.unmock('./tcpForwarder');

import { TunnelAgent } from './tunnel';

// ---------------------------------------------------------------------------
// Helpers for TunnelAgent tests that need the ws mock
// ---------------------------------------------------------------------------

/** Get an event handler from the mock WS instance */
function getWsHandler<T>(event: string): T {
  const call = mockWsInstance.on.mock.calls.find(
    (c: unknown[]) => c[0] === event,
  );
  if (!call) throw new Error(`No handler registered for '${event}'`);
  return call[1] as T;
}

// =========================================================================
// Connection Resilience
// =========================================================================

describe('Connection Resilience', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMockWsInstance();
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(process, 'once').mockImplementation(() => process);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reconnects with exponential backoff after server disconnects', () => {
    const cfg = makeConfig({ reconnectInitialMs: 100, reconnectMaxMs: 10_000 });
    const agent = new TunnelAgent(cfg);
    agent.start();

    const closeHandler = getWsHandler<(code: number, reason: Buffer) => void>('close');

    // First disconnect — delay is 100ms, next will be 200
    closeHandler(1006, Buffer.from('connection lost'));
    expect((agent as unknown as { reconnectDelay: number }).reconnectDelay).toBe(200);

    // Advance past first reconnect delay (100ms) — triggers connect()
    resetMockWsInstance();
    vi.advanceTimersByTime(100);

    // Second disconnect — delay should be 200ms, next will be 400
    const closeHandler2 = getWsHandler<(code: number, reason: Buffer) => void>('close');
    closeHandler2(1006, Buffer.from('connection lost'));
    expect((agent as unknown as { reconnectDelay: number }).reconnectDelay).toBe(400);

    // Third disconnect
    resetMockWsInstance();
    vi.advanceTimersByTime(200);
    const closeHandler3 = getWsHandler<(code: number, reason: Buffer) => void>('close');
    closeHandler3(1006, Buffer.from('connection lost'));
    expect((agent as unknown as { reconnectDelay: number }).reconnectDelay).toBe(800);
  });

  it('resumes normal operation after reconnection', () => {
    const cfg = makeConfig({ reconnectInitialMs: 100 });
    const agent = new TunnelAgent(cfg);
    agent.start();

    // Trigger open then close
    const openHandler = getWsHandler<() => void>('open');
    openHandler();

    const closeHandler = getWsHandler<(code: number, reason: Buffer) => void>('close');
    closeHandler(1006, Buffer.from('lost'));

    // Reconnect
    resetMockWsInstance();
    vi.advanceTimersByTime(100);

    // After reconnect, trigger open again — backoff should be reset
    const openHandler2 = getWsHandler<() => void>('open');
    openHandler2();
    expect((agent as unknown as { reconnectDelay: number }).reconnectDelay).toBe(cfg.reconnectInitialMs);

    // Message handler should be functional — sending a PING frame should respond with PONG
    const msgHandler = getWsHandler<(data: Buffer) => void>('message');
    const pingFrame = buildFrame(MsgType.PING, 0);
    msgHandler(pingFrame);
    expect(mockWsInstance.send).toHaveBeenCalled();
    const sentFrame = mockWsInstance.send.mock.calls[0][0] as Buffer;
    expect(sentFrame[0]).toBe(MsgType.PONG);
  });

  it('handles rapid connect/disconnect cycles without crashing', () => {
    const cfg = makeConfig({ reconnectInitialMs: 10, reconnectMaxMs: 100 });
    const agent = new TunnelAgent(cfg);
    agent.start();

    for (let i = 0; i < 10; i++) {
      const openHandler = getWsHandler<() => void>('open');
      openHandler();

      const closeHandler = getWsHandler<(code: number, reason: Buffer) => void>('close');
      closeHandler(1006, Buffer.from('lost'));

      resetMockWsInstance();
      vi.advanceTimersByTime(100); // enough to trigger any pending reconnect
    }

    // Agent should still be alive (not stopped)
    expect((agent as unknown as { stopped: boolean }).stopped).toBe(false);
  });

  it('survives server sending garbage data', () => {
    const cfg = makeConfig();
    const agent = new TunnelAgent(cfg);
    agent.start();

    const msgHandler = getWsHandler<(data: Buffer) => void>('message');

    // Garbage: not valid binary frames
    expect(() => msgHandler(Buffer.from('not a frame at all!!'))).not.toThrow();
    expect(() => msgHandler(Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff]))).not.toThrow();
    expect(() => msgHandler(Buffer.from(''))).not.toThrow();
    expect(() => msgHandler(Buffer.alloc(2))).not.toThrow();
    // String that looks like JSON
    expect(() => msgHandler(Buffer.from('{"type":"hello"}'))).not.toThrow();
  });

  it('handles WebSocket close codes gracefully', () => {
    const closeCodes: Array<{ code: number; shouldReconnect: boolean }> = [
      { code: 1000, shouldReconnect: true }, // Normal close — reconnect (server may have rotated)
      { code: 1001, shouldReconnect: true }, // Going away
      { code: 1006, shouldReconnect: true }, // Abnormal
      { code: 1011, shouldReconnect: true }, // Server error
    ];

    for (const { code } of closeCodes) {
      resetMockWsInstance();
      const cfg = makeConfig({ reconnectInitialMs: 50 });
      const agent = new TunnelAgent(cfg);
      vi.spyOn(process, 'once').mockImplementation(() => process);
      agent.start();

      const closeHandler = getWsHandler<(code: number, reason: Buffer) => void>('close');
      closeHandler(code, Buffer.from('reason'));

      // All codes should schedule a reconnect (reconnectTimer set)
      expect((agent as unknown as { reconnectTimer: ReturnType<typeof setTimeout> | null }).reconnectTimer).not.toBeNull();

      // Stop to clean up
      agent.stop();
    }
  });
});

// =========================================================================
// TCP Forwarder Resilience
// =========================================================================

describe('TCP Forwarder Resilience', () => {
  let connectSpy: ReturnType<typeof vi.spyOn>;
  let fakeSocket: ReturnType<typeof mockSocket>;

  beforeEach(() => {
    fakeSocket = mockSocket();
    connectSpy = vi.spyOn(net, 'connect').mockReturnValue(fakeSocket as unknown as net.Socket);
  });

  afterEach(() => {
    destroyAllSockets();
    connectSpy.mockRestore();
  });

  it('handles upstream connection refused', () => {
    const ws = mockWs();
    handleOpenFrame(ws, 1, Buffer.from('localhost:59999', 'utf8'));

    // Simulate connection refused
    fakeSocket._emit('error', new Error('connect ECONNREFUSED'));

    // Should send CLOSE frame back
    const closeCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: unknown[]) => {
        const buf = call[0] as Buffer;
        return buf[0] === MsgType.CLOSE;
      },
    );
    expect(closeCalls.length).toBeGreaterThanOrEqual(1);

    // Stream should be cleaned up
    expect(activeStreamCount()).toBe(0);
    expect(fakeSocket.destroy).toHaveBeenCalled();
  });

  it('handles upstream connection timeout', () => {
    vi.useFakeTimers();
    const ws = mockWs();
    handleOpenFrame(ws, 2, Buffer.from('localhost:59998', 'utf8'));

    // Socket is created but never fires 'connect' — simulate timeout via error
    fakeSocket._emit('error', new Error('connect ETIMEDOUT'));

    // Should send CLOSE frame
    const closeCalls = (ws.send as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: unknown[]) => (call[0] as Buffer)[0] === MsgType.CLOSE,
    );
    expect(closeCalls.length).toBeGreaterThanOrEqual(1);
    expect(activeStreamCount()).toBe(0);

    vi.useRealTimers();
  });

  it('handles concurrent OPEN frames for different streams', () => {
    const ws = mockWs();
    const sockets: ReturnType<typeof mockSocket>[] = [];

    for (let i = 0; i < 20; i++) {
      const sock = mockSocket();
      sockets.push(sock);
      connectSpy.mockReturnValueOnce(sock as unknown as net.Socket);
    }

    // Fire 20 OPEN frames
    for (let i = 0; i < 20; i++) {
      handleOpenFrame(ws, i + 1, Buffer.from(`localhost:${4822 + i}`, 'utf8'));
    }

    // Connect all
    for (let i = 0; i < 20; i++) {
      sockets[i]._emit('connect');
    }

    expect(activeStreamCount()).toBe(20);

    // Clean up
    destroyAllSockets();
    expect(activeStreamCount()).toBe(0);
  });

  it('handles DATA frame for non-existent stream', () => {
    // Stream 999 was never opened — should not crash
    expect(() => handleDataFrame(999, Buffer.from('orphan data'))).not.toThrow();
    expect(activeStreamCount()).toBe(0);
  });

  it('handles CLOSE frame for already-closed stream (idempotent)', () => {
    const ws = mockWs();
    handleOpenFrame(ws, 10, Buffer.from('localhost:4822', 'utf8'));
    fakeSocket._emit('connect');

    expect(activeStreamCount()).toBe(1);

    // First close
    handleCloseFrame(ws, 10);
    expect(activeStreamCount()).toBe(0);

    // Second close — must be idempotent
    expect(() => handleCloseFrame(ws, 10)).not.toThrow();
    expect(activeStreamCount()).toBe(0);
  });

  it('handles massive data throughput — 10000 DATA frames in order', () => {
    const ws = mockWs();
    handleOpenFrame(ws, 50, Buffer.from('localhost:4822', 'utf8'));
    fakeSocket._emit('connect');

    const payloads: Buffer[] = [];
    for (let i = 0; i < 10_000; i++) {
      const payload = Buffer.from(`frame-${i}`);
      payloads.push(payload);
      handleDataFrame(50, payload);
    }

    // All 10000 frames should have been written to the socket
    expect(fakeSocket.write).toHaveBeenCalledTimes(10_000);

    // Verify order: first and last
    const writeCalls = fakeSocket.write.mock.calls as unknown[][];
    expect(writeCalls[0][0]).toEqual(Buffer.from('frame-0'));
    expect(writeCalls[9999][0]).toEqual(Buffer.from('frame-9999'));
  });
});

// =========================================================================
// SSRF Prevention (Security Resilience)
// =========================================================================

describe('SSRF Prevention (Security Resilience)', () => {
  let connectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    connectSpy = vi.spyOn(net, 'connect').mockReturnValue(mockSocket() as unknown as net.Socket);
  });

  afterEach(() => {
    destroyAllSockets();
    connectSpy.mockRestore();
  });

  it('rejects DNS rebinding attacks — internal IP variants', () => {
    const ws = mockWs();
    const evasionAttempts = [
      '0.0.0.0:22',
      '0x7f000001:22',
      '127.0.0.1:1@evil.com:22',
    ];

    for (const target of evasionAttempts) {
      handleOpenFrame(ws, 100, Buffer.from(target, 'utf8'));
    }

    // None should have opened a TCP connection (all rejected by SSRF check)
    // Note: 0.0.0.0 and 0x7f000001 are not in ALLOWED_HOSTS
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('rejects all non-localhost targets', () => {
    const ws = mockWs();
    const blockedHosts = [
      '10.0.0.1',
      '192.168.1.1',
      '172.16.0.1',
      'evil.com',
      'google.com',
      'localhost.evil.com',
    ];

    for (let i = 0; i < blockedHosts.length; i++) {
      handleOpenFrame(ws, 200 + i, Buffer.from(`${blockedHosts[i]}:22`, 'utf8'));
    }

    // None should create TCP connections
    expect(connectSpy).not.toHaveBeenCalled();

    // Each should get a CLOSE frame back
    expect((ws.send as ReturnType<typeof vi.fn>).mock.calls.length).toBe(blockedHosts.length);
    for (const call of (ws.send as ReturnType<typeof vi.fn>).mock.calls) {
      const frame = call[0] as Buffer;
      expect(frame[0]).toBe(MsgType.CLOSE);
    }
  });
});

// =========================================================================
// Frame Protocol Resilience
// =========================================================================

describe('Frame Protocol Resilience', () => {
  let connectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    connectSpy = vi.spyOn(net, 'connect').mockReturnValue(mockSocket() as unknown as net.Socket);
  });

  afterEach(() => {
    destroyAllSockets();
    connectSpy.mockRestore();
  });

  it('handles zero-length DATA frames without crashing', () => {
    const ws = mockWs();
    const sock = mockSocket();
    connectSpy.mockReturnValueOnce(sock as unknown as net.Socket);

    handleOpenFrame(ws, 1, Buffer.from('localhost:4822', 'utf8'));
    sock._emit('connect');

    // Zero-length data frame
    expect(() => handleDataFrame(1, Buffer.alloc(0))).not.toThrow();
    expect(sock.write).toHaveBeenCalledWith(Buffer.alloc(0));
  });

  it('handles maximum stream ID (0xFFFF)', () => {
    const ws = mockWs();
    const sock = mockSocket();
    connectSpy.mockReturnValueOnce(sock as unknown as net.Socket);

    const maxStreamId = 0xFFFF;
    handleOpenFrame(ws, maxStreamId, Buffer.from('localhost:4822', 'utf8'));
    sock._emit('connect');

    expect(activeStreamCount()).toBe(1);

    // DATA should work on max stream ID
    handleDataFrame(maxStreamId, Buffer.from('boundary test'));
    expect(sock.write).toHaveBeenCalledWith(Buffer.from('boundary test'));

    // CLOSE should work on max stream ID
    handleCloseFrame(ws, maxStreamId);
    expect(activeStreamCount()).toBe(0);
  });

  it('handles rapid OPEN/CLOSE cycles — 100 streams with no leaked sockets', () => {
    const ws = mockWs();

    for (let i = 0; i < 100; i++) {
      const sock = mockSocket();
      connectSpy.mockReturnValueOnce(sock as unknown as net.Socket);

      handleOpenFrame(ws, i + 1, Buffer.from('localhost:4822', 'utf8'));
      sock._emit('connect');
      handleCloseFrame(ws, i + 1);

      expect(sock.destroy).toHaveBeenCalled();
    }

    expect(activeStreamCount()).toBe(0);
  });

  it('handles out-of-order CLOSE during pending OPEN', () => {
    const ws = mockWs();
    const sock = mockSocket();
    connectSpy.mockReturnValueOnce(sock as unknown as net.Socket);

    // Send OPEN — socket is created but connect event hasn't fired yet
    handleOpenFrame(ws, 77, Buffer.from('localhost:4822', 'utf8'));

    // Before connect fires, send CLOSE for that stream
    // Since the socket is not yet in activeSockets, this is a no-op
    expect(() => handleCloseFrame(ws, 77)).not.toThrow();

    // Now connect fires — socket gets added to activeSockets
    sock._emit('connect');

    // The stream is still alive because CLOSE was a no-op (socket wasn't registered yet)
    // This is the actual behavior — the code adds to activeSockets on 'connect'
    expect(activeStreamCount()).toBe(1);

    // Clean up properly
    handleCloseFrame(ws, 77);
    expect(activeStreamCount()).toBe(0);
  });
});

// =========================================================================
// Graceful Shutdown
// =========================================================================

describe('Graceful Shutdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMockWsInstance();
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(process, 'once').mockImplementation(() => process);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stop() during active transfers — all sockets destroyed, no lingering timers', () => {
    const cfg = makeConfig({ pingIntervalMs: 1000 });
    const agent = new TunnelAgent(cfg);
    agent.start();

    // Simulate open + ping timer started
    const openHandler = getWsHandler<() => void>('open');
    openHandler();

    // Verify ping timer is set
    expect((agent as unknown as { pingTimer: ReturnType<typeof setInterval> | null }).pingTimer).not.toBeNull();

    agent.stop();

    // All timers should be cleared
    expect((agent as unknown as { pingTimer: ReturnType<typeof setInterval> | null }).pingTimer).toBeNull();
    expect((agent as unknown as { reconnectTimer: ReturnType<typeof setTimeout> | null }).reconnectTimer).toBeNull();
    expect((agent as unknown as { stopped: boolean }).stopped).toBe(true);
    expect(mockWsInstance.close).toHaveBeenCalledWith(1001, 'agent shutdown');
  });

  it('stop() during reconnection backoff — exits immediately without waiting', () => {
    const cfg = makeConfig({ reconnectInitialMs: 30_000 });
    const agent = new TunnelAgent(cfg);
    agent.start();

    // Trigger close to start backoff
    const closeHandler = getWsHandler<(code: number, reason: Buffer) => void>('close');
    closeHandler(1006, Buffer.from('lost'));

    // Reconnect timer should be set
    expect((agent as unknown as { reconnectTimer: ReturnType<typeof setTimeout> | null }).reconnectTimer).not.toBeNull();

    // Stop during backoff — should clear the timer immediately
    agent.stop();

    expect((agent as unknown as { reconnectTimer: ReturnType<typeof setTimeout> | null }).reconnectTimer).toBeNull();
    expect((agent as unknown as { stopped: boolean }).stopped).toBe(true);

    // Advancing time should NOT trigger a reconnect
    resetMockWsInstance();
    vi.advanceTimersByTime(30_000);
    // If reconnect happened, on() would be called — it should not
    expect(mockWsInstance.on).not.toHaveBeenCalled();
  });

  it('double stop() is safe', () => {
    const cfg = makeConfig();
    const agent = new TunnelAgent(cfg);
    agent.start();

    // First stop
    agent.stop();
    expect((agent as unknown as { stopped: boolean }).stopped).toBe(true);

    // Second stop — ws is already closed, should not throw
    // readyState is no longer OPEN after first close
    mockWsInstance.readyState = 3; // WebSocket.CLOSED
    expect(() => agent.stop()).not.toThrow();
  });
});
