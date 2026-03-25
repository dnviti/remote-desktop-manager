import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TunnelConfig } from './config';
import { MsgType, buildFrame } from './protocol';

// Mock ws module before importing TunnelAgent
const mockWsInstance = {
  readyState: 1, // WebSocket.OPEN
  on: vi.fn(),
  send: vi.fn(),
  close: vi.fn(),
};

vi.mock('ws', () => {
  // Must use a real function (not arrow) so it can be called with `new`
  function MockWebSocket() {
    return mockWsInstance;
  }
  MockWebSocket.OPEN = 1;
  MockWebSocket.CLOSED = 3;
  return { default: MockWebSocket, WebSocket: MockWebSocket };
});

// Mock the tcpForwarder to prevent real TCP connections
vi.mock('./tcpForwarder', () => ({
  handleOpenFrame: vi.fn(),
  handleDataFrame: vi.fn(),
  handleCloseFrame: vi.fn(),
  destroyAllSockets: vi.fn(),
  activeStreamCount: vi.fn(() => 0),
}));

// Mock net.connect for probeLocalService — auto-fires 'connect' on next tick
vi.mock('net', () => {
  const createMockSocket = () => {
    const handlers: Record<string, (() => void)[]> = {};
    const socket = {
      destroyed: false,
      once: vi.fn((event: string, handler: () => void) => {
        if (!handlers[event]) handlers[event] = [];
        handlers[event].push(handler);
        // Auto-fire 'connect' synchronously so probeLocalService resolves
        if (event === 'connect') {
          queueMicrotask(() => handler());
        }
        return socket;
      }),
      destroy: vi.fn(() => { socket.destroyed = true; }),
    };
    return socket;
  };
  return {
    default: { connect: vi.fn(() => createMockSocket()) },
    connect: vi.fn(() => createMockSocket()),
  };
});

import { TunnelAgent } from './tunnel';
import {
  handleOpenFrame,
  handleDataFrame,
  handleCloseFrame,
  destroyAllSockets,
} from './tcpForwarder';

function makeConfig(overrides: Partial<TunnelConfig> = {}): TunnelConfig {
  return {
    serverUrl: 'wss://example.com/tunnel',
    token: 'test-token',
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

describe('TunnelAgent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Reset mock ws instance state
    mockWsInstance.readyState = 1;
    mockWsInstance.on.mockReset();
    mockWsInstance.send.mockReset();
    mockWsInstance.close.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stores config and initializes reconnect delay', () => {
    const cfg = makeConfig({ reconnectInitialMs: 2000 });
    const agent = new TunnelAgent(cfg);
    // Access private field via type assertion for testing
    expect((agent as unknown as { reconnectDelay: number }).reconnectDelay).toBe(2000);
  });

  describe('start', () => {
    it('creates a WebSocket connection to the server URL', () => {
      const cfg = makeConfig();
      const agent = new TunnelAgent(cfg);

      // Prevent process.exit in stop()
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const onceSpy = vi.spyOn(process, 'once').mockImplementation(() => process);

      agent.start();

      expect(mockWsInstance.on).toHaveBeenCalledWith('open', expect.any(Function));
      expect(mockWsInstance.on).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mockWsInstance.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockWsInstance.on).toHaveBeenCalledWith('error', expect.any(Function));

      exitSpy.mockRestore();
      onceSpy.mockRestore();
    });

    it('registers SIGTERM and SIGINT handlers', () => {
      const cfg = makeConfig();
      const agent = new TunnelAgent(cfg);
      const onceSpy = vi.spyOn(process, 'once').mockImplementation(() => process);
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      agent.start();

      expect(onceSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      expect(onceSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));

      exitSpy.mockRestore();
      onceSpy.mockRestore();
    });
  });

  describe('stop', () => {
    it('closes WebSocket and destroys all sockets', () => {
      const cfg = makeConfig();
      const agent = new TunnelAgent(cfg);
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      vi.spyOn(process, 'once').mockImplementation(() => process);

      agent.start();
      agent.stop();

      expect(mockWsInstance.close).toHaveBeenCalledWith(1001, 'agent shutdown');
      expect(destroyAllSockets).toHaveBeenCalled();

      exitSpy.mockRestore();
    });

    it('sets stopped flag to prevent reconnection', () => {
      const cfg = makeConfig();
      const agent = new TunnelAgent(cfg);
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      vi.spyOn(process, 'once').mockImplementation(() => process);

      agent.start();
      agent.stop();

      expect((agent as unknown as { stopped: boolean }).stopped).toBe(true);

      exitSpy.mockRestore();
    });
  });

  describe('exponential backoff', () => {
    it('doubles reconnect delay on each reconnection attempt', () => {
      const cfg = makeConfig({ reconnectInitialMs: 500, reconnectMaxMs: 10000 });
      const agent = new TunnelAgent(cfg);
      vi.spyOn(process, 'once').mockImplementation(() => process);
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      agent.start();

      // Find and trigger the 'close' handler
      const closeHandler = mockWsInstance.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'close'
      )?.[1] as (code: number, reason: Buffer) => void;
      expect(closeHandler).toBeDefined();

      // Trigger close to initiate reconnect
      closeHandler(1006, Buffer.from('connection lost'));

      // After first close, delay should double from 500 to 1000
      expect((agent as unknown as { reconnectDelay: number }).reconnectDelay).toBe(1000);

      exitSpy.mockRestore();
    });

    it('caps reconnect delay at reconnectMaxMs', () => {
      const cfg = makeConfig({ reconnectInitialMs: 500, reconnectMaxMs: 2000 });
      const agent = new TunnelAgent(cfg);
      vi.spyOn(process, 'once').mockImplementation(() => process);
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      agent.start();

      const closeHandler = mockWsInstance.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'close'
      )?.[1] as (code: number, reason: Buffer) => void;

      // Trigger multiple closes to ramp up backoff
      closeHandler(1006, Buffer.from('lost'));
      vi.advanceTimersByTime(500);
      closeHandler(1006, Buffer.from('lost'));
      vi.advanceTimersByTime(1000);
      closeHandler(1006, Buffer.from('lost'));
      vi.advanceTimersByTime(2000);
      closeHandler(1006, Buffer.from('lost'));

      // Should be capped at 2000
      expect((agent as unknown as { reconnectDelay: number }).reconnectDelay).toBe(2000);

      exitSpy.mockRestore();
    });
  });

  describe('heartbeat', () => {
    it('sends PING frames at the configured interval', async () => {
      const cfg = makeConfig({ pingIntervalMs: 5000 });
      const agent = new TunnelAgent(cfg);
      vi.spyOn(process, 'once').mockImplementation(() => process);
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

      agent.start();

      // Find and trigger the 'open' handler
      const openHandler = mockWsInstance.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'open'
      )?.[1] as () => void;
      expect(openHandler).toBeDefined();
      openHandler();

      // Advance past the ping interval
      await vi.advanceTimersByTimeAsync(5000);

      // send should have been called with a PING frame
      expect(mockWsInstance.send).toHaveBeenCalled();
      const sendCall = mockWsInstance.send.mock.calls[0];
      const frame = sendCall[0] as Buffer;
      expect(frame[0]).toBe(MsgType.PING);
      expect(frame.readUInt16BE(2)).toBe(0); // streamId 0 for ping

      exitSpy.mockRestore();
    });
  });

  describe('handleMessage', () => {
    function getMessageHandler(agent: TunnelAgent): (data: Buffer) => void {
      vi.spyOn(process, 'once').mockImplementation(() => process);
      agent.start();

      const msgHandler = mockWsInstance.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'message'
      )?.[1] as (data: Buffer) => void;
      expect(msgHandler).toBeDefined();
      return msgHandler;
    }

    it('dispatches OPEN frames to handleOpenFrame', () => {
      const agent = new TunnelAgent(makeConfig());
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const handler = getMessageHandler(agent);

      const frame = buildFrame(MsgType.OPEN, 1, Buffer.from('localhost:4822'));
      handler(frame);

      expect(handleOpenFrame).toHaveBeenCalledWith(
        mockWsInstance,
        1,
        expect.any(Buffer),
      );

      exitSpy.mockRestore();
    });

    it('dispatches DATA frames to handleDataFrame', () => {
      const agent = new TunnelAgent(makeConfig());
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const handler = getMessageHandler(agent);

      const frame = buildFrame(MsgType.DATA, 42, Buffer.from('hello'));
      handler(frame);

      expect(handleDataFrame).toHaveBeenCalledWith(42, expect.any(Buffer));

      exitSpy.mockRestore();
    });

    it('dispatches CLOSE frames to handleCloseFrame', () => {
      const agent = new TunnelAgent(makeConfig());
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const handler = getMessageHandler(agent);

      const frame = buildFrame(MsgType.CLOSE, 99);
      handler(frame);

      expect(handleCloseFrame).toHaveBeenCalledWith(mockWsInstance, 99);

      exitSpy.mockRestore();
    });

    it('responds with PONG when receiving PING', () => {
      const agent = new TunnelAgent(makeConfig());
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const handler = getMessageHandler(agent);

      const frame = buildFrame(MsgType.PING, 0);
      handler(frame);

      expect(mockWsInstance.send).toHaveBeenCalled();
      const sentFrame = mockWsInstance.send.mock.calls[0][0] as Buffer;
      expect(sentFrame[0]).toBe(MsgType.PONG);

      exitSpy.mockRestore();
    });

    it('ignores frames that are too short', () => {
      const agent = new TunnelAgent(makeConfig());
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const handler = getMessageHandler(agent);

      // 3 bytes is less than HEADER_SIZE (4)
      handler(Buffer.alloc(3));

      expect(handleOpenFrame).not.toHaveBeenCalled();
      expect(handleDataFrame).not.toHaveBeenCalled();
      expect(handleCloseFrame).not.toHaveBeenCalled();

      exitSpy.mockRestore();
    });

    it('handles ArrayBuffer data', () => {
      const agent = new TunnelAgent(makeConfig());
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const handler = getMessageHandler(agent);

      const frame = buildFrame(MsgType.DATA, 5, Buffer.from('test'));
      // Convert to ArrayBuffer
      const ab = frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength);
      handler(ab as unknown as Buffer);

      expect(handleDataFrame).toHaveBeenCalledWith(5, expect.any(Buffer));

      exitSpy.mockRestore();
    });

    it('handles Buffer array data', () => {
      const agent = new TunnelAgent(makeConfig());
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const handler = getMessageHandler(agent);

      const frame = buildFrame(MsgType.DATA, 7, Buffer.from('multi'));
      // Wrap in array to simulate Buffer[]
      handler([frame] as unknown as Buffer);

      expect(handleDataFrame).toHaveBeenCalledWith(7, expect.any(Buffer));

      exitSpy.mockRestore();
    });
  });
});
