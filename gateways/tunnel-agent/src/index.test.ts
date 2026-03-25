import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Since index.ts has top-level side effects (calls loadConfig, may call process.exit,
// creates TunnelAgent and calls start), we use dynamic imports with vi.resetModules().

/** Sentinel error thrown by the mocked process.exit to halt execution. */
class ExitCalled extends Error {
  code: number;
  constructor(code: number) {
    super(`process.exit(${code})`);
    this.code = code;
  }
}

describe('index.ts entry point', () => {
  const originalStdoutWrite = process.stdout.write;

  beforeEach(() => {
    vi.resetModules();
    // Capture stdout without printing during tests
    process.stdout.write = vi.fn() as unknown as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = originalStdoutWrite;
    vi.restoreAllMocks();
  });

  it('enters dormant mode when loadConfig returns null', async () => {
    vi.doMock('./config', () => ({
      loadConfig: vi.fn(() => null),
    }));

    vi.doMock('./tunnel', () => ({
      TunnelAgent: vi.fn(),
    }));

    // Mock process.exit to throw so top-level code halts after exit(0)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ExitCalled(code as number);
    });

    try {
      await import('./index');
    } catch (e) {
      expect(e).toBeInstanceOf(ExitCalled);
      expect((e as ExitCalled).code).toBe(0);
    }

    expect(process.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining('dormant mode'),
    );
    expect(exitSpy).toHaveBeenCalledWith(0);

    exitSpy.mockRestore();
  });

  it('creates TunnelAgent and calls start when config is valid', async () => {
    const mockStart = vi.fn();

    const fakeConfig = {
      serverUrl: 'wss://example.com/tunnel',
      token: 'tok',
      gatewayId: 'gw-1',
      agentVersion: '1.0.0',
      pingIntervalMs: 15000,
      reconnectInitialMs: 1000,
      reconnectMaxMs: 60000,
      localServiceHost: 'localhost',
      localServicePort: 4822,
    };

    vi.doMock('./config', () => ({
      loadConfig: vi.fn(() => fakeConfig),
    }));

    // Use a real class so `new TunnelAgent(cfg)` works
    vi.doMock('./tunnel', () => ({
      TunnelAgent: class MockAgent {
        start = mockStart;
      },
    }));

    await import('./index');

    expect(mockStart).toHaveBeenCalled();
  });

  it('logs gateway and server info when starting', async () => {
    const mockStart = vi.fn();

    vi.doMock('./config', () => ({
      loadConfig: vi.fn(() => ({
        serverUrl: 'wss://broker.example.com/tunnel',
        token: 'tok',
        gatewayId: 'gw-test-42',
        agentVersion: '1.0.0',
        pingIntervalMs: 15000,
        reconnectInitialMs: 1000,
        reconnectMaxMs: 60000,
        localServiceHost: 'localhost',
        localServicePort: 4822,
      })),
    }));

    vi.doMock('./tunnel', () => ({
      TunnelAgent: class MockAgent {
        start = mockStart;
      },
    }));

    await import('./index');

    expect(process.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining('gw-test-42'),
    );
    expect(process.stdout.write).toHaveBeenCalledWith(
      expect.stringContaining('wss://broker.example.com/tunnel'),
    );
  });
});
