import { vi, describe, it, expect, beforeEach } from 'vitest';

// Stable mock functions that persist across vi.resetModules()
const mockResolve4 = vi.fn();
const mockResolve6 = vi.fn();
const mockLookup = vi.fn();

const mockNetworkInterfaces = vi.fn().mockReturnValue({
  eth0: [
    {
      address: '192.168.50.10',
      netmask: '255.255.255.0',
      family: 'IPv4',
      mac: '00:00:00:00:00:00',
      internal: false,
      cidr: '192.168.50.10/24',
    },
  ],
  lo: [
    {
      address: '127.0.0.1',
      netmask: '255.0.0.0',
      family: 'IPv4',
      mac: '00:00:00:00:00:00',
      internal: true,
      cidr: '127.0.0.1/8',
    },
    {
      address: '::1',
      netmask: 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
      family: 'IPv6',
      mac: '00:00:00:00:00:00',
      internal: true,
      cidr: '::1/128',
    },
  ],
});

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    default: {
      ...actual,
      networkInterfaces: (...args: unknown[]) => mockNetworkInterfaces(...args),
    },
    networkInterfaces: (...args: unknown[]) => mockNetworkInterfaces(...args),
  };
});

vi.mock('dns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('dns')>();
  return {
    ...actual,
    default: {
      ...actual,
      promises: {
        resolve4: (...args: unknown[]) => mockResolve4(...args),
        resolve6: (...args: unknown[]) => mockResolve6(...args),
        lookup: (...args: unknown[]) => mockLookup(...args),
      },
    },
    promises: {
      resolve4: (...args: unknown[]) => mockResolve4(...args),
      resolve6: (...args: unknown[]) => mockResolve6(...args),
      lookup: (...args: unknown[]) => mockLookup(...args),
    },
  };
});

/**
 * Helper to get a fresh validateHost with the desired ALLOW_LOCAL_NETWORK setting.
 * Because the module reads process.env at load time, we must reset modules and re-import.
 */
async function loadValidateHost(allowLocalNetwork: boolean, allowLoopback = false) {
  vi.resetModules();
  // Must set explicitly to 'false' rather than deleting, because dotenv
  // loads .env during module import and would re-set the value if the key is absent.
  process.env.ALLOW_LOCAL_NETWORK = allowLocalNetwork ? 'true' : 'false';
  process.env.ALLOW_LOOPBACK = allowLoopback ? 'true' : 'false';
  const mod = await import('./hostValidation');
  return mod.validateHost;
}

describe('hostValidation (ALLOW_LOCAL_NETWORK=false)', () => {
  let validateHost: (host: string) => Promise<void>;

  beforeEach(async () => {
    validateHost = await loadValidateHost(false);
    // Default: all DNS calls fail (ENOTFOUND-like)
    mockResolve4.mockRejectedValue(new Error('ENOTFOUND'));
    mockResolve6.mockRejectedValue(new Error('ENOTFOUND'));
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));
  });

  it('rejects "localhost" string', async () => {
    await expect(validateHost('localhost')).rejects.toThrow();
    await expect(validateHost('localhost')).rejects.toHaveProperty(
      'statusCode',
      400
    );
  });

  it('rejects "LOCALHOST" (case-insensitive)', async () => {
    await expect(validateHost('LOCALHOST')).rejects.toThrow();
  });

  it('rejects 127.0.0.1 (loopback)', async () => {
    await expect(validateHost('127.0.0.1')).rejects.toThrow();
    await expect(validateHost('127.0.0.1')).rejects.toHaveProperty(
      'statusCode',
      400
    );
  });

  it('rejects ::1 (IPv6 loopback)', async () => {
    await expect(validateHost('::1')).rejects.toThrow();
    await expect(validateHost('::1')).rejects.toHaveProperty(
      'statusCode',
      400
    );
  });

  it('rejects 0.0.0.0 (wildcard)', async () => {
    await expect(validateHost('0.0.0.0')).rejects.toThrow();
    await expect(validateHost('0.0.0.0')).rejects.toHaveProperty(
      'statusCode',
      400
    );
  });

  it('rejects 10.0.0.1 (private class A)', async () => {
    await expect(validateHost('10.0.0.1')).rejects.toThrow();
    await expect(validateHost('10.0.0.1')).rejects.toHaveProperty(
      'statusCode',
      400
    );
  });

  it('rejects 172.16.0.1 (private class B)', async () => {
    await expect(validateHost('172.16.0.1')).rejects.toThrow();
    await expect(validateHost('172.16.0.1')).rejects.toHaveProperty(
      'statusCode',
      400
    );
  });

  it('rejects 192.168.1.1 (private class C)', async () => {
    await expect(validateHost('192.168.1.1')).rejects.toThrow();
    await expect(validateHost('192.168.1.1')).rejects.toHaveProperty(
      'statusCode',
      400
    );
  });

  it('rejects 169.254.169.254 (link-local / metadata)', async () => {
    await expect(validateHost('169.254.169.254')).rejects.toThrow();
    await expect(validateHost('169.254.169.254')).rejects.toHaveProperty(
      'statusCode',
      400
    );
  });

  it('rejects fe80::1 (IPv6 link-local)', async () => {
    await expect(validateHost('fe80::1')).rejects.toThrow();
    await expect(validateHost('fe80::1')).rejects.toHaveProperty(
      'statusCode',
      400
    );
  });

  it('rejects fd00::1 (IPv6 ULA)', async () => {
    await expect(validateHost('fd00::1')).rejects.toThrow();
    await expect(validateHost('fd00::1')).rejects.toHaveProperty(
      'statusCode',
      400
    );
  });

  it('allows 8.8.8.8 (public IP)', async () => {
    await expect(validateHost('8.8.8.8')).resolves.toBeUndefined();
  });

  it('allows 203.0.113.1 (public IP)', async () => {
    await expect(validateHost('203.0.113.1')).resolves.toBeUndefined();
  });

  it('rejects hostname that resolves to a forbidden IP', async () => {
    mockResolve4.mockResolvedValue(['127.0.0.1']);
    mockResolve6.mockRejectedValue(new Error('ENOTFOUND'));
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));

    await expect(validateHost('evil.example.com')).rejects.toThrow();
    await expect(validateHost('evil.example.com')).rejects.toHaveProperty(
      'statusCode',
      400
    );
  });

  it('rejects hostname that resolves to a private IP via lookup', async () => {
    mockResolve4.mockRejectedValue(new Error('ENOTFOUND'));
    mockResolve6.mockRejectedValue(new Error('ENOTFOUND'));
    mockLookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);

    await expect(validateHost('internal.example.com')).rejects.toThrow();
    await expect(validateHost('internal.example.com')).rejects.toHaveProperty(
      'statusCode',
      400
    );
  });

  it('allows hostname that resolves to a public IP', async () => {
    mockResolve4.mockResolvedValue(['93.184.216.34']);
    mockResolve6.mockRejectedValue(new Error('ENOTFOUND'));
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));

    await expect(validateHost('example.com')).resolves.toBeUndefined();
  });

  it('allows hostname when DNS resolution fails entirely (ENOTFOUND)', async () => {
    mockResolve4.mockRejectedValue(new Error('ENOTFOUND'));
    mockResolve6.mockRejectedValue(new Error('ENOTFOUND'));
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));

    // Should pass -- connection will fail at runtime
    await expect(
      validateHost('nonexistent.example.com')
    ).resolves.toBeUndefined();
  });

  it('rejects hostname when one of multiple resolved IPs is forbidden', async () => {
    mockResolve4.mockResolvedValue(['93.184.216.34', '192.168.1.1']);
    mockResolve6.mockRejectedValue(new Error('ENOTFOUND'));
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));

    await expect(validateHost('mixed.example.com')).rejects.toThrow();
  });
});

describe('hostValidation (ALLOW_LOCAL_NETWORK=true)', () => {
  let validateHost: (host: string) => Promise<void>;

  beforeEach(async () => {
    validateHost = await loadValidateHost(true);
    mockResolve4.mockRejectedValue(new Error('ENOTFOUND'));
    mockResolve6.mockRejectedValue(new Error('ENOTFOUND'));
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));
  });

  it('still rejects localhost', async () => {
    await expect(validateHost('localhost')).rejects.toThrow();
  });

  it('still rejects 127.0.0.1 (loopback always blocked)', async () => {
    await expect(validateHost('127.0.0.1')).rejects.toThrow();
  });

  it('still rejects ::1 (loopback always blocked)', async () => {
    await expect(validateHost('::1')).rejects.toThrow();
  });

  it('still rejects 0.0.0.0 (wildcard always blocked)', async () => {
    await expect(validateHost('0.0.0.0')).rejects.toThrow();
  });

  it('still rejects 169.254.169.254 (link-local always blocked)', async () => {
    await expect(validateHost('169.254.169.254')).rejects.toThrow();
  });

  it('still rejects fe80::1 (IPv6 link-local always blocked)', async () => {
    await expect(validateHost('fe80::1')).rejects.toThrow();
  });

  it('allows 10.0.0.1 (private ranges permitted)', async () => {
    await expect(validateHost('10.0.0.1')).resolves.toBeUndefined();
  });

  it('allows 172.16.0.1 (private ranges permitted)', async () => {
    await expect(validateHost('172.16.0.1')).resolves.toBeUndefined();
  });

  it('allows 192.168.1.1 (private ranges permitted)', async () => {
    await expect(validateHost('192.168.1.1')).resolves.toBeUndefined();
  });

  it('allows fd00::1 (IPv6 ULA permitted)', async () => {
    await expect(validateHost('fd00::1')).resolves.toBeUndefined();
  });

  it('allows public IPs', async () => {
    await expect(validateHost('8.8.8.8')).resolves.toBeUndefined();
  });
});

describe('hostValidation (ALLOW_LOOPBACK=true, ALLOW_LOCAL_NETWORK=true)', () => {
  let validateHost: (host: string) => Promise<void>;

  beforeEach(async () => {
    validateHost = await loadValidateHost(true, true);
    mockResolve4.mockRejectedValue(new Error('ENOTFOUND'));
    mockResolve6.mockRejectedValue(new Error('ENOTFOUND'));
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));
  });

  it('allows "localhost" string', async () => {
    await expect(validateHost('localhost')).resolves.toBeUndefined();
  });

  it('allows 127.0.0.1 (loopback)', async () => {
    await expect(validateHost('127.0.0.1')).resolves.toBeUndefined();
  });

  it('allows 127.0.0.2 (loopback range)', async () => {
    await expect(validateHost('127.0.0.2')).resolves.toBeUndefined();
  });

  it('allows ::1 (IPv6 loopback)', async () => {
    await expect(validateHost('::1')).resolves.toBeUndefined();
  });

  it('allows 10.0.0.1 (private range)', async () => {
    await expect(validateHost('10.0.0.1')).resolves.toBeUndefined();
  });

  it('allows 192.168.1.1 (private range)', async () => {
    await expect(validateHost('192.168.1.1')).resolves.toBeUndefined();
  });

  it('still rejects 0.0.0.0 (wildcard always blocked)', async () => {
    await expect(validateHost('0.0.0.0')).rejects.toThrow();
  });

  it('still rejects :: (wildcard always blocked)', async () => {
    await expect(validateHost('::')).rejects.toThrow();
  });

  it('still rejects 169.254.169.254 (link-local always blocked)', async () => {
    await expect(validateHost('169.254.169.254')).rejects.toThrow();
  });

  it('still rejects fe80::1 (IPv6 link-local always blocked)', async () => {
    await expect(validateHost('fe80::1')).rejects.toThrow();
  });

  it('allows public IPs', async () => {
    await expect(validateHost('8.8.8.8')).resolves.toBeUndefined();
  });

  it('allows hostname that resolves to loopback', async () => {
    mockResolve4.mockResolvedValue(['127.0.0.1']);
    mockResolve6.mockRejectedValue(new Error('ENOTFOUND'));
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));

    await expect(validateHost('myapp.local')).resolves.toBeUndefined();
  });
});

describe('hostValidation (ALLOW_LOOPBACK=true, ALLOW_LOCAL_NETWORK=false)', () => {
  let validateHost: (host: string) => Promise<void>;

  beforeEach(async () => {
    validateHost = await loadValidateHost(false, true);
    mockResolve4.mockRejectedValue(new Error('ENOTFOUND'));
    mockResolve6.mockRejectedValue(new Error('ENOTFOUND'));
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));
  });

  it('allows "localhost" string', async () => {
    await expect(validateHost('localhost')).resolves.toBeUndefined();
  });

  it('allows 127.0.0.1 (loopback)', async () => {
    await expect(validateHost('127.0.0.1')).resolves.toBeUndefined();
  });

  it('allows ::1 (IPv6 loopback)', async () => {
    await expect(validateHost('::1')).resolves.toBeUndefined();
  });

  it('rejects 10.0.0.1 (private range still blocked)', async () => {
    await expect(validateHost('10.0.0.1')).rejects.toThrow();
  });

  it('rejects 172.16.0.1 (private range still blocked)', async () => {
    await expect(validateHost('172.16.0.1')).rejects.toThrow();
  });

  it('rejects 192.168.1.1 (private range still blocked)', async () => {
    await expect(validateHost('192.168.1.1')).rejects.toThrow();
  });

  it('rejects fd00::1 (IPv6 ULA still blocked)', async () => {
    await expect(validateHost('fd00::1')).rejects.toThrow();
  });

  it('still rejects 0.0.0.0 (wildcard always blocked)', async () => {
    await expect(validateHost('0.0.0.0')).rejects.toThrow();
  });

  it('still rejects 169.254.169.254 (link-local always blocked)', async () => {
    await expect(validateHost('169.254.169.254')).rejects.toThrow();
  });

  it('allows public IPs', async () => {
    await expect(validateHost('8.8.8.8')).resolves.toBeUndefined();
  });
});
