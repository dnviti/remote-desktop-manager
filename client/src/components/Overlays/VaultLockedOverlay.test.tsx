import React, { StrictMode } from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { waitFor } from '@testing-library/dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import VaultLockedOverlay from './VaultLockedOverlay';
import { useVaultStore } from '../../store/vaultStore';
import { useAuthStore } from '../../store/authStore';

const {
  getVaultStatus,
  unlockVault,
  unlockVaultWithTotp,
  requestVaultWebAuthnOptions,
  unlockVaultWithWebAuthn,
  requestVaultSmsCode,
  unlockVaultWithSms,
} = vi.hoisted(() => ({
  getVaultStatus: vi.fn(),
  unlockVault: vi.fn(),
  unlockVaultWithTotp: vi.fn(),
  requestVaultWebAuthnOptions: vi.fn(),
  unlockVaultWithWebAuthn: vi.fn(),
  requestVaultSmsCode: vi.fn(),
  unlockVaultWithSms: vi.fn(),
}));

const { logoutApi } = vi.hoisted(() => ({
  logoutApi: vi.fn(),
}));

const { startAuthentication } = vi.hoisted(() => ({
  startAuthentication: vi.fn(),
}));

const { broadcastVaultWindowSync } = vi.hoisted(() => ({
  broadcastVaultWindowSync: vi.fn(),
}));

vi.mock('../../api/vault.api', () => ({
  getVaultStatus,
  unlockVault,
  unlockVaultWithTotp,
  requestVaultWebAuthnOptions,
  unlockVaultWithWebAuthn,
  requestVaultSmsCode,
  unlockVaultWithSms,
}));

vi.mock('../../api/auth.api', () => ({
  logoutApi,
}));

vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication,
}));

vi.mock('../../utils/vaultWindowSync', () => ({
  broadcastVaultWindowSync,
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('VaultLockedOverlay', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();

    useAuthStore.setState({
      accessToken: 'access-token',
      csrfToken: 'csrf-token',
      user: {
        id: 'user-1',
        email: 'admin@example.com',
        username: null,
        avatarData: null,
      },
      isAuthenticated: true,
      permissionsLoaded: false,
      permissionsLoading: false,
      permissionsSubject: null,
    });
    useVaultStore.setState({
      unlocked: false,
      initialized: false,
      mfaUnlockAvailable: false,
      mfaUnlockMethods: [],
    });

    unlockVault.mockResolvedValue({ unlocked: true });
    getVaultStatus.mockResolvedValue({
      unlocked: false,
      vaultNeedsRecovery: false,
      mfaUnlockAvailable: false,
      mfaUnlockMethods: [],
    });
    unlockVaultWithTotp.mockResolvedValue({ unlocked: true });
    unlockVaultWithWebAuthn.mockResolvedValue({ unlocked: true });
    requestVaultSmsCode.mockResolvedValue({ sent: true });
    unlockVaultWithSms.mockResolvedValue({ unlocked: true });
    logoutApi.mockResolvedValue(undefined);
  });

  it('prefers passkey over password when vault WebAuthn unlock is available', async () => {
    requestVaultWebAuthnOptions.mockResolvedValue({ challenge: 'vault-challenge' });
    startAuthentication.mockReturnValue(deferred<never>().promise);

    const view = render(<VaultLockedOverlay />);

    await act(async () => {
      useVaultStore.getState().applyStatus({
        unlocked: false,
        vaultNeedsRecovery: false,
        mfaUnlockAvailable: true,
        mfaUnlockMethods: ['webauthn'],
      });
    });

    expect(
      await view.findByText('Waiting for your security key or passkey...'),
    ).toBeInTheDocument();
    expect(view.queryByLabelText('Password')).not.toBeInTheDocument();
  });

  it('refreshes stale locked status before choosing the unlock method', async () => {
    getVaultStatus.mockResolvedValue({
      unlocked: false,
      vaultNeedsRecovery: false,
      mfaUnlockAvailable: true,
      mfaUnlockMethods: ['webauthn'],
    });
    requestVaultWebAuthnOptions.mockResolvedValue({ challenge: 'vault-challenge' });
    startAuthentication.mockReturnValue(deferred<never>().promise);

    const view = render(<VaultLockedOverlay />);

    await act(async () => {
      useVaultStore.setState({
        unlocked: false,
        initialized: true,
        mfaUnlockAvailable: false,
        mfaUnlockMethods: [],
      });
    });

    await waitFor(() => {
      expect(getVaultStatus).toHaveBeenCalledTimes(1);
    });
    expect(
      await view.findByText('Waiting for your security key or passkey...'),
    ).toBeInTheDocument();
    expect(view.queryByLabelText('Password')).not.toBeInTheDocument();
  });

  it('auto-starts vault passkey unlock only once per lock cycle', async () => {
    requestVaultWebAuthnOptions.mockResolvedValue({ challenge: 'vault-challenge' });
    startAuthentication.mockReturnValue(deferred<never>().promise);

    render(
      <StrictMode>
        <VaultLockedOverlay />
      </StrictMode>,
    );

    await act(async () => {
      useVaultStore.getState().applyStatus({
        unlocked: false,
        vaultNeedsRecovery: false,
        mfaUnlockAvailable: true,
        mfaUnlockMethods: ['webauthn'],
      });
    });

    await waitFor(() => {
      expect(requestVaultWebAuthnOptions).toHaveBeenCalledTimes(1);
    });
    expect(startAuthentication).toHaveBeenCalledTimes(1);
  });

  it('broadcasts an unlock signal after password unlock succeeds', async () => {
    const view = render(<VaultLockedOverlay />);

    await act(async () => {
      useVaultStore.setState({
        unlocked: false,
        initialized: true,
        mfaUnlockAvailable: false,
        mfaUnlockMethods: [],
      });
    });

    fireEvent.change(view.getByLabelText('Password'), { target: { value: 'vault-password' } });
    fireEvent.click(view.getByRole('button', { name: 'Unlock Vault' }));

    await waitFor(() => {
      expect(unlockVault).toHaveBeenCalledWith('vault-password');
    });
    expect(useVaultStore.getState()).toMatchObject({ unlocked: true, initialized: true });
    expect(broadcastVaultWindowSync).toHaveBeenCalledWith('unlock');
  });
});
