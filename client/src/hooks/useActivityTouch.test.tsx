import { render } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { touchAuthActivityApi } from '../api/auth.api';
import { touchVaultActivityApi } from '../api/vault.api';
import { useAuthStore } from '../store/authStore';
import { useVaultStore } from '../store/vaultStore';
import { emptyPermissionFlags } from '../utils/permissionFlags';
import { useActivityTouch } from './useActivityTouch';
import { broadcastVaultWindowSync } from '../utils/vaultWindowSync';

vi.mock('../api/auth.api', () => ({
  touchAuthActivityApi: vi.fn(),
}));

vi.mock('../api/vault.api', () => ({
  touchVaultActivityApi: vi.fn(),
}));

vi.mock('../utils/vaultWindowSync', () => ({
  broadcastVaultWindowSync: vi.fn(),
}));

function Probe() {
  useActivityTouch();
  return null;
}

describe('useActivityTouch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-20T12:00:00.000Z'));
    vi.clearAllMocks();
    vi.mocked(touchAuthActivityApi).mockResolvedValue({ ok: true });
    vi.mocked(touchVaultActivityApi).mockResolvedValue({ unlocked: true });
    useAuthStore.setState({
      accessToken: 'access-token',
      csrfToken: 'csrf-token',
      user: {
        id: 'user-1',
        email: 'admin@example.com',
        username: 'admin',
        avatarData: null,
        tenantId: 'tenant-1',
        tenantRole: 'OWNER',
      },
      isAuthenticated: true,
      permissions: emptyPermissionFlags(),
      permissionsLoaded: false,
      permissionsLoading: false,
      permissionsSubject: null,
    });
    useVaultStore.setState({
      unlocked: true,
      initialized: true,
      mfaUnlockAvailable: true,
      mfaUnlockMethods: ['webauthn'],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('only touches auth and vault after real user activity', async () => {
    render(<Probe />);

    expect(touchAuthActivityApi).not.toHaveBeenCalled();
    expect(touchVaultActivityApi).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));
      await Promise.resolve();
    });

    expect(touchAuthActivityApi).toHaveBeenCalledTimes(1);
    expect(touchVaultActivityApi).toHaveBeenCalledTimes(1);
  });

  it('throttles repeated activity until the touch interval elapses', async () => {
    render(<Probe />);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));
      await Promise.resolve();
    });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'B' }));
      await Promise.resolve();
    });

    expect(touchAuthActivityApi).toHaveBeenCalledTimes(1);
    expect(touchVaultActivityApi).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(60_001);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'C' }));
      await Promise.resolve();
    });

    expect(touchAuthActivityApi).toHaveBeenCalledTimes(2);
    expect(touchVaultActivityApi).toHaveBeenCalledTimes(2);
  });

  it('locks the vault store immediately when the touch response says it is locked', async () => {
    vi.mocked(touchVaultActivityApi).mockResolvedValue({ unlocked: false });

    render(<Probe />);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'A' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(touchVaultActivityApi).toHaveBeenCalledTimes(1);
    expect(useVaultStore.getState()).toMatchObject({
      unlocked: false,
      initialized: true,
    });
    expect(broadcastVaultWindowSync).toHaveBeenCalledWith('lock');
  });
});
