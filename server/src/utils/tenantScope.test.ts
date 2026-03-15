import { AppError } from '../middleware/error.middleware';

const mockFindMany = vi.fn();

vi.mock('../lib/prisma', () => ({
  default: {
    tenantMember: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
  },
}));

vi.mock('../config', () => ({
  config: {
    get allowExternalSharing() {
      return process.env.ALLOW_EXTERNAL_SHARING === 'true';
    },
  },
}));

import {
  assertSameTenant,
  tenantScopedTeamFilter,
  assertShareableTenantBoundary,
} from './tenantScope';

describe('assertSameTenant', () => {
  it('passes when userTenantId is null (backward compat)', () => {
    expect(() => assertSameTenant(null, 'tenant-1')).not.toThrow();
  });

  it('passes when userTenantId is undefined', () => {
    expect(() => assertSameTenant(undefined, 'tenant-1')).not.toThrow();
  });

  it('passes when resourceTenantId is null (personal resource)', () => {
    expect(() => assertSameTenant('tenant-1', null)).not.toThrow();
  });

  it('passes when both tenant IDs are the same', () => {
    expect(() => assertSameTenant('tenant-1', 'tenant-1')).not.toThrow();
  });

  it('throws 403 AppError when tenant IDs differ', () => {
    expect(() => assertSameTenant('tenant-1', 'tenant-2')).toThrow(AppError);
    try {
      assertSameTenant('tenant-1', 'tenant-2');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(403);
      expect((err as AppError).message).toBe('Access denied');
    }
  });
});

describe('tenantScopedTeamFilter', () => {
  it('returns empty object when tenantId is null', () => {
    expect(tenantScopedTeamFilter(null)).toEqual({});
  });

  it('returns empty object when tenantId is undefined', () => {
    expect(tenantScopedTeamFilter(undefined)).toEqual({});
  });

  it('returns scoped filter when tenantId is valid', () => {
    expect(tenantScopedTeamFilter('tenant-abc')).toEqual({
      team: { tenantId: 'tenant-abc' },
    });
  });
});

describe('assertShareableTenantBoundary', () => {
  beforeEach(() => {
    mockFindMany.mockReset();
  });

  it('passes when both users are untenanted', async () => {
    mockFindMany.mockResolvedValue([]);
    await expect(
      assertShareableTenantBoundary('user-1', 'user-2'),
    ).resolves.toBeUndefined();
  });

  it('passes when users share a tenant', async () => {
    mockFindMany
      .mockResolvedValueOnce([{ tenantId: 'tenant-1' }])
      .mockResolvedValueOnce([{ tenantId: 'tenant-1' }, { tenantId: 'tenant-2' }]);
    await expect(
      assertShareableTenantBoundary('user-1', 'user-2'),
    ).resolves.toBeUndefined();
  });

  it('throws 403 when users have no common tenant', async () => {
    mockFindMany
      .mockResolvedValueOnce([{ tenantId: 'tenant-1' }])
      .mockResolvedValueOnce([{ tenantId: 'tenant-2' }]);
    await expect(
      assertShareableTenantBoundary('user-1', 'user-2'),
    ).rejects.toThrow(AppError);
    // Verify status code and message
    mockFindMany
      .mockResolvedValueOnce([{ tenantId: 'tenant-1' }])
      .mockResolvedValueOnce([{ tenantId: 'tenant-2' }]);
    try {
      await assertShareableTenantBoundary('user-1', 'user-2');
    } catch (err) {
      expect((err as AppError).statusCode).toBe(403);
      expect((err as AppError).message).toBe(
        'Cannot share connections with users outside your tenant',
      );
    }
  });

  it('skips check when ALLOW_EXTERNAL_SHARING is true', async () => {
    const origVal = process.env.ALLOW_EXTERNAL_SHARING;
    process.env.ALLOW_EXTERNAL_SHARING = 'true';
    try {
      mockFindMany
        .mockResolvedValueOnce([{ tenantId: 'tenant-1' }])
        .mockResolvedValueOnce([{ tenantId: 'tenant-2' }]);
      await expect(
        assertShareableTenantBoundary('user-1', 'user-2'),
      ).resolves.toBeUndefined();
      // Should not have queried DB at all
      expect(mockFindMany).not.toHaveBeenCalled();
    } finally {
      if (origVal === undefined) {
        delete process.env.ALLOW_EXTERNAL_SHARING;
      } else {
        process.env.ALLOW_EXTERNAL_SHARING = origVal;
      }
    }
  });
});
