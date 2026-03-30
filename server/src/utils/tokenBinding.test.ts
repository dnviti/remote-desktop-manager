import { describe, it, expect, vi } from 'vitest';

vi.mock('./ip', () => ({
  getClientIp: vi.fn(() => '1.2.3.4'),
}));

import { computeBindingHash, getRequestBinding, getSocketUserAgent } from './tokenBinding';

describe('computeBindingHash', () => {
  it('returns the same hash for the same input', () => {
    const hash1 = computeBindingHash('10.0.0.1', 'Mozilla/5.0');
    const hash2 = computeBindingHash('10.0.0.1', 'Mozilla/5.0');
    expect(hash1).toBe(hash2);
  });

  it('returns different hashes for different inputs', () => {
    const hash1 = computeBindingHash('10.0.0.1', 'Mozilla/5.0');
    const hash2 = computeBindingHash('10.0.0.2', 'Mozilla/5.0');
    expect(hash1).not.toBe(hash2);
  });

  it('returns a 64-character hex string', () => {
    const hash = computeBindingHash('10.0.0.1', 'Mozilla/5.0');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('getRequestBinding', () => {
  it('extracts IP and User-Agent from the request', () => {
    const req = {
      get: vi.fn((header: string) => {
        if (header === 'user-agent') return 'TestAgent/1.0';
        return undefined;
      }),
    } as unknown as import('express').Request;

    const binding = getRequestBinding(req);
    expect(binding).toEqual({ ip: '1.2.3.4', userAgent: 'TestAgent/1.0' });
  });
});

describe('getSocketUserAgent', () => {
  const makeSocket = (ua: string | string[] | undefined) =>
    ({
      handshake: { headers: { 'user-agent': ua } },
    }) as { handshake: { headers: { 'user-agent': string | string[] | undefined } } };

  it('returns the UA string as-is when it is a string', () => {
    expect(getSocketUserAgent(makeSocket('TestAgent/1.0'))).toBe('TestAgent/1.0');
  });

  it('returns the first element when UA is an array', () => {
    expect(getSocketUserAgent(makeSocket(['First', 'Second']))).toBe('First');
  });

  it('returns an empty string when UA is undefined', () => {
    expect(getSocketUserAgent(makeSocket(undefined))).toBe('');
  });
});
