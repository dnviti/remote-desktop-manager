import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import net from 'net';
import { MsgType } from './protocol';

// We need to isolate the module-level activeSockets map between tests,
// so we re-import via a dynamic import after resetting modules.
// However, the simplest approach: test the exported functions and
// clear state via destroyAllSockets between tests.

import {
  handleOpenFrame,
  handleDataFrame,
  handleCloseFrame,
  destroyAllSockets,
  activeStreamCount,
} from './tcpForwarder';

/** Create a minimal mock WebSocket with readyState and send/close */
function mockWs(readyState = 1) {
  return {
    readyState,
    send: vi.fn(),
    close: vi.fn(),
  } as unknown as import('ws').WebSocket;
}

/** Create a mock Socket with EventEmitter-like interface */
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

describe('tcpForwarder', () => {
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

  describe('handleOpenFrame', () => {
    it('parses host:port from payload and opens TCP connection', () => {
      const ws = mockWs();
      const payload = Buffer.from('localhost:4822', 'utf8');
      handleOpenFrame(ws, 1, payload);

      expect(connectSpy).toHaveBeenCalledWith(4822, 'localhost');
    });

    it('sends CLOSE frame for invalid target without colon', () => {
      const ws = mockWs();
      const payload = Buffer.from('invalid-target', 'utf8');
      handleOpenFrame(ws, 1, payload);

      expect(connectSpy).not.toHaveBeenCalled();
      expect(ws.send).toHaveBeenCalledTimes(1);
      const sentFrame = (ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as Buffer;
      expect(sentFrame[0]).toBe(MsgType.CLOSE);
    });

    it('sends CLOSE frame for invalid port', () => {
      const ws = mockWs();
      const payload = Buffer.from('localhost:99999', 'utf8');
      handleOpenFrame(ws, 2, payload);

      expect(connectSpy).not.toHaveBeenCalled();
      expect(ws.send).toHaveBeenCalledTimes(1);
    });

    it('sends CLOSE frame for non-numeric port', () => {
      const ws = mockWs();
      const payload = Buffer.from('localhost:abc', 'utf8');
      handleOpenFrame(ws, 3, payload);

      expect(connectSpy).not.toHaveBeenCalled();
      expect(ws.send).toHaveBeenCalledTimes(1);
    });

    it('rejects non-localhost host (SSRF prevention)', () => {
      const ws = mockWs();
      const payload = Buffer.from('evil.com:22', 'utf8');
      handleOpenFrame(ws, 4, payload);

      expect(connectSpy).not.toHaveBeenCalled();
      expect(ws.send).toHaveBeenCalledTimes(1);
      const sentFrame = (ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as Buffer;
      expect(sentFrame[0]).toBe(MsgType.CLOSE);
    });

    it('rejects 192.168.1.1 host (SSRF prevention)', () => {
      const ws = mockWs();
      const payload = Buffer.from('192.168.1.1:22', 'utf8');
      handleOpenFrame(ws, 5, payload);

      expect(connectSpy).not.toHaveBeenCalled();
    });

    it('allows localhost target', () => {
      const ws = mockWs();
      handleOpenFrame(ws, 10, Buffer.from('localhost:2222', 'utf8'));
      expect(connectSpy).toHaveBeenCalledWith(2222, 'localhost');
    });

    it('allows 127.0.0.1 target', () => {
      const ws = mockWs();
      handleOpenFrame(ws, 11, Buffer.from('127.0.0.1:3389', 'utf8'));
      expect(connectSpy).toHaveBeenCalledWith(3389, '127.0.0.1');
    });

    it('allows ::1 target', () => {
      const ws = mockWs();
      handleOpenFrame(ws, 12, Buffer.from('::1:5900', 'utf8'));
      expect(connectSpy).toHaveBeenCalledWith(5900, '::1');
    });

    it('sends OPEN ack frame when TCP connection succeeds', () => {
      const ws = mockWs();
      handleOpenFrame(ws, 20, Buffer.from('localhost:4822', 'utf8'));

      // Simulate the 'connect' event
      fakeSocket._emit('connect');

      expect(ws.send).toHaveBeenCalled();
      const sentFrame = (ws.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as Buffer;
      expect(sentFrame[0]).toBe(MsgType.OPEN);
      expect(sentFrame.readUInt16BE(2)).toBe(20);
    });

    it('registers socket as active after connect', () => {
      const ws = mockWs();
      handleOpenFrame(ws, 30, Buffer.from('localhost:4822', 'utf8'));
      fakeSocket._emit('connect');

      expect(activeStreamCount()).toBe(1);
    });
  });

  describe('handleDataFrame', () => {
    it('writes payload to the correct stream socket', () => {
      const ws = mockWs();
      handleOpenFrame(ws, 50, Buffer.from('localhost:4822', 'utf8'));
      fakeSocket._emit('connect');

      const payload = Buffer.from('some data');
      handleDataFrame(50, payload);

      expect(fakeSocket.write).toHaveBeenCalledWith(payload);
    });

    it('ignores DATA for unknown stream', () => {
      // Should not throw
      handleDataFrame(999, Buffer.from('data'));
    });
  });

  describe('handleCloseFrame', () => {
    it('destroys the socket for the given stream', () => {
      const ws = mockWs();
      handleOpenFrame(ws, 60, Buffer.from('localhost:4822', 'utf8'));
      fakeSocket._emit('connect');

      expect(activeStreamCount()).toBe(1);

      handleCloseFrame(ws, 60);

      expect(fakeSocket.destroy).toHaveBeenCalled();
      expect(activeStreamCount()).toBe(0);
    });

    it('is a no-op for unknown stream', () => {
      const ws = mockWs();
      // Should not throw
      handleCloseFrame(ws, 999);
    });
  });

  describe('activeStreamCount', () => {
    it('returns 0 when no streams are active', () => {
      expect(activeStreamCount()).toBe(0);
    });

    it('returns correct count after opening streams', () => {
      const ws = mockWs();

      // Open two different streams with two different mock sockets
      const socket1 = mockSocket();
      const socket2 = mockSocket();
      connectSpy.mockReturnValueOnce(socket1 as unknown as net.Socket)
                .mockReturnValueOnce(socket2 as unknown as net.Socket);

      handleOpenFrame(ws, 100, Buffer.from('localhost:4822', 'utf8'));
      socket1._emit('connect');

      handleOpenFrame(ws, 101, Buffer.from('localhost:4822', 'utf8'));
      socket2._emit('connect');

      expect(activeStreamCount()).toBe(2);
    });
  });

  describe('destroyAllSockets', () => {
    it('clears all active sockets', () => {
      const ws = mockWs();

      const socket1 = mockSocket();
      const socket2 = mockSocket();
      connectSpy.mockReturnValueOnce(socket1 as unknown as net.Socket)
                .mockReturnValueOnce(socket2 as unknown as net.Socket);

      handleOpenFrame(ws, 200, Buffer.from('localhost:4822', 'utf8'));
      socket1._emit('connect');
      handleOpenFrame(ws, 201, Buffer.from('localhost:4822', 'utf8'));
      socket2._emit('connect');

      expect(activeStreamCount()).toBe(2);

      destroyAllSockets();

      expect(activeStreamCount()).toBe(0);
      expect(socket1.destroy).toHaveBeenCalled();
      expect(socket2.destroy).toHaveBeenCalled();
    });
  });
});
