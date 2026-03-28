import { getClientIp, getSocketClientIp } from './ip';

function mockReq(overrides: { headers?: Record<string, string | string[]>; ip?: string; remoteAddress?: string }) {
  return {
    headers: overrides.headers ?? {},
    ip: overrides.ip,
    socket: { remoteAddress: overrides.remoteAddress ?? '127.0.0.1' },
  } as any;
}

function mockSocket(overrides: { headers?: Record<string, string>; address?: string }) {
  return {
    handshake: {
      headers: overrides.headers ?? {},
      address: overrides.address ?? '127.0.0.1',
    },
  } as any;
}

describe('getClientIp', () => {
  it('falls back to req.ip when no X-Forwarded-For header', () => {
    const req = mockReq({ ip: '198.51.100.10' });
    expect(getClientIp(req)).toBe('198.51.100.10');
  });

  it('falls back to req.socket.remoteAddress when req.ip is undefined', () => {
    const req = mockReq({ ip: undefined, remoteAddress: '198.51.100.20' });
    expect(getClientIp(req)).toBe('198.51.100.20');
  });

  it('strips ::ffff: prefix from fallback ip', () => {
    const req = mockReq({ ip: '::ffff:198.51.100.10' });
    expect(getClientIp(req)).toBe('198.51.100.10');
  });
});

describe('getSocketClientIp', () => {
  it('falls back to handshake address when no x-forwarded-for', () => {
    const socket = mockSocket({ address: '198.51.100.5' });
    expect(getSocketClientIp(socket)).toBe('198.51.100.5');
  });

  it('strips ::ffff: prefix from handshake address', () => {
    const socket = mockSocket({ address: '::ffff:198.51.100.5' });
    expect(getSocketClientIp(socket)).toBe('198.51.100.5');
  });
});
