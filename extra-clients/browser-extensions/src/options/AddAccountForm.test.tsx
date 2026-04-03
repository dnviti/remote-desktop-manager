// @vitest-environment jsdom

import React from 'react';
import { render } from '@testing-library/react';
import { fireEvent, screen, waitFor } from '@testing-library/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddAccountForm } from './AddAccountForm';
import type { LoginResult } from '../types';

vi.mock('../lib/apiClient', () => ({
  healthCheck: vi.fn(),
}));

vi.mock('../lib/auth', () => ({
  login: vi.fn(),
  requestSmsCode: vi.fn(),
  requestWebAuthnOptions: vi.fn(),
  switchTenant: vi.fn(),
  verifySms: vi.fn(),
  verifyTotp: vi.fn(),
  verifyWebAuthn: vi.fn(),
}));

vi.mock('../lib/webauthn', () => ({
  startWebAuthnAuthentication: vi.fn(),
  getExpectedChallenge: vi.fn(),
  formatWebAuthnError: vi.fn((error: unknown) => String(error)),
}));

import { healthCheck } from '../lib/apiClient';
import { login, switchTenant, verifyTotp } from '../lib/auth';

describe('AddAccountForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('completes MFA login and tenant selection for a new account', async () => {
    const onComplete = vi.fn(async () => undefined);

    vi.mocked(healthCheck).mockResolvedValue({
      success: true,
      data: { status: 'ok' },
    });

    vi.mocked(login).mockResolvedValue({
      success: true,
      data: {
        requiresMFA: true,
        methods: ['totp'],
        requiresTOTP: true,
        tempToken: 'temp-token',
      },
    });

    const loginResult: LoginResult = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      accountId: 'account-1',
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'User',
        tenantId: 'tenant-1',
        tenantName: 'Tenant One',
      },
      tenantMemberships: [
        {
          tenantId: 'tenant-1',
          name: 'Tenant One',
          slug: 'tenant-one',
          role: 'Owner',
          isActive: true,
        },
        {
          tenantId: 'tenant-2',
          name: 'Tenant Two',
          slug: 'tenant-two',
          role: 'Operator',
          isActive: false,
        },
      ],
    };

    vi.mocked(verifyTotp).mockResolvedValue({
      success: true,
      data: loginResult,
    });

    vi.mocked(switchTenant).mockResolvedValue({
      success: true,
      data: {
        accessToken: 'switched-token',
        user: loginResult.user,
      },
    });

    render(<AddAccountForm onComplete={onComplete} onCancel={() => undefined} />);

    fireEvent.change(screen.getByLabelText('Server URL'), {
      target: { value: 'https://arsenale.example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Check Connection' }));

    await screen.findByLabelText('Email');

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Account' }));

    await screen.findByLabelText('Authenticator code');

    fireEvent.change(screen.getByLabelText('Authenticator code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    await screen.findByText('Tenant Two');

    fireEvent.click(screen.getByRole('button', { name: /Tenant Two/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(switchTenant).toHaveBeenCalledWith('account-1', 'tenant-2');
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });
});
