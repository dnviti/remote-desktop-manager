// @vitest-environment jsdom

import React from 'react';
import { render } from '@testing-library/react';
import { fireEvent, screen, waitFor } from '@testing-library/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MfaPage } from './MfaPage';
import type { LoginResult } from '../../types';

vi.mock('../../lib/apiClient', () => ({
  sendMessage: vi.fn(),
}));

vi.mock('../../lib/webauthn', () => ({
  startWebAuthnAuthentication: vi.fn(),
  getExpectedChallenge: vi.fn((options: Record<string, unknown>) => options.challenge),
  formatWebAuthnError: vi.fn((error: unknown) => String(error)),
}));

import { sendMessage } from '../../lib/apiClient';
import { startWebAuthnAuthentication } from '../../lib/webauthn';

describe('MfaPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('completes WebAuthn verification when the method is available', async () => {
    const onSuccess = vi.fn();
    const result: LoginResult = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      accountId: 'account-1',
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'User',
      },
    };

    vi.mocked(sendMessage)
      .mockResolvedValueOnce({
        success: true,
        data: { challenge: 'challenge-1' },
      })
      .mockResolvedValueOnce({
        success: true,
        data: result,
      });

    vi.mocked(startWebAuthnAuthentication).mockResolvedValue({
      id: 'credential-1',
    });

    render(
      <MfaPage
        serverUrl="https://arsenale.example.com"
        email="user@example.com"
        tempToken="temp-token"
        methods={['webauthn']}
        requiresTOTP={false}
        onSuccess={onSuccess}
        onCancel={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Use Security Key' }));

    await waitFor(() => {
      expect(sendMessage).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          type: 'VERIFY_WEBAUTHN',
          expectedChallenge: 'challenge-1',
        }),
      );
      expect(onSuccess).toHaveBeenCalledWith(result);
    });
  });
});
