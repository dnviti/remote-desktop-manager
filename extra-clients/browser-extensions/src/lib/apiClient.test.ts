import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock } from '../test/chrome';
import { apiRequest, healthCheck, login, sendMessage } from './apiClient';

describe('apiClient', () => {
  let runtime: ReturnType<typeof installChromeMock>['runtime'];

  beforeEach(() => {
    ({ runtime } = installChromeMock());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns runtime lastError information when messaging fails', async () => {
    runtime.sendMessage.mockImplementation(
      (_message: unknown, callback: (response?: unknown) => void) => {
        runtime.lastError = { message: 'Service worker unavailable' };
        callback(undefined);
        runtime.lastError = null;
      }
    );

    await expect(sendMessage({ type: 'GET_ACCOUNTS' })).resolves.toEqual({
      success: false,
      error: 'Service worker unavailable',
    });
  });

  it('returns a default error when the background script sends no response', async () => {
    runtime.sendMessage.mockImplementation(
      (_message: unknown, callback: (response?: unknown) => void) => {
        callback(undefined);
      }
    );

    await expect(sendMessage({ type: 'GET_ACCOUNTS' })).resolves.toEqual({
      success: false,
      error: 'No response from background',
    });
  });

  it('builds the expected payloads for api, health, and login requests', async () => {
    runtime.sendMessage.mockImplementation(
      (_message: unknown, callback: (response?: unknown) => void) => {
        callback({ success: true, data: { ok: true } });
      }
    );

    await apiRequest('account-1', 'POST', '/connections', { name: 'db' });
    await healthCheck('https://arsenale.example.com');
    await login('https://arsenale.example.com', 'user@example.com', 'secret');

    expect(runtime.sendMessage).toHaveBeenNthCalledWith(
      1,
      {
        type: 'API_REQUEST',
        accountId: 'account-1',
        method: 'POST',
        path: '/connections',
        body: { name: 'db' },
      },
      expect.any(Function)
    );
    expect(runtime.sendMessage).toHaveBeenNthCalledWith(
      2,
      {
        type: 'HEALTH_CHECK',
        serverUrl: 'https://arsenale.example.com',
      },
      expect.any(Function)
    );
    expect(runtime.sendMessage).toHaveBeenNthCalledWith(
      3,
      {
        type: 'LOGIN',
        serverUrl: 'https://arsenale.example.com',
        email: 'user@example.com',
        password: 'secret',
      },
      expect.any(Function)
    );
  });
});
