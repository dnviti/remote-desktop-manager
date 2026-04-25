import axios, { type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api, { readCsrfTokenForBrowserRequests, readRequestHeader } from './client';
import { useAuthStore } from '../store/authStore';
import { emptyPermissionFlags } from '../utils/permissionFlags';

type RetryableRequestConfig = InternalAxiosRequestConfig & { _retry?: boolean };

const sessionUser = {
  id: 'user-1',
  email: 'admin@example.com',
  username: 'admin',
  avatarData: null,
  tenantId: 'tenant-1',
  tenantRole: 'OWNER',
};

describe('api client auth recovery', () => {
  const originalAdapter = api.defaults.adapter;

  beforeEach(() => {
    vi.restoreAllMocks();
    api.defaults.adapter = originalAdapter;
    localStorage.clear();
    document.cookie = 'arsenale-csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    useAuthStore.setState({
      accessToken: 'stale-access-token',
      csrfToken: 'persisted-csrf-token',
      user: sessionUser,
      isAuthenticated: true,
      permissions: emptyPermissionFlags(),
      permissionsLoaded: false,
      permissionsLoading: false,
      permissionsSubject: null,
    });
  });

  it('uses the browser CSRF cookie instead of stale persisted state for write requests', async () => {
    document.cookie = 'arsenale-csrf=browser-cookie-token; path=/';
    let capturedConfig: InternalAxiosRequestConfig | null = null;
    api.defaults.adapter = vi.fn(async (config) => {
      capturedConfig = config;
      return {
        data: { ok: true },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      } satisfies AxiosResponse;
    });

    await api.post('/vault/lock');

    expect(readCsrfTokenForBrowserRequests()).toBe('browser-cookie-token');
    expect(capturedConfig).not.toBeNull();
    expect(readRequestHeader(capturedConfig ?? {}, 'X-CSRF-Token')).toBe('browser-cookie-token');
  });

  it('restores the browser session on 401 instead of calling refresh directly', async () => {
    const restoreSessionSpy = vi.spyOn(axios, 'get').mockResolvedValue({
      data: {
        accessToken: 'restored-access-token',
        csrfToken: 'restored-csrf-token',
        user: sessionUser,
      },
    } as AxiosResponse);
    const refreshSpy = vi.spyOn(axios, 'post');

    let protectedRequestCount = 0;
    api.defaults.adapter = vi.fn(async (config) => {
      if (config.url === '/protected' && protectedRequestCount === 0) {
        protectedRequestCount += 1;
        return Promise.reject({
          config,
          response: { status: 401 },
        });
      }

      return {
        data: {
          authorization: readRequestHeader(config, 'Authorization'),
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      } satisfies AxiosResponse;
    });

    const response = await api.get('/protected');

    expect(restoreSessionSpy).toHaveBeenCalledWith('/api/auth/session', { withCredentials: true });
    expect(refreshSpy).not.toHaveBeenCalledWith('/api/auth/refresh', expect.anything());
    expect(response.data.authorization).toBe('Bearer restored-access-token');
    expect(useAuthStore.getState()).toMatchObject({
      accessToken: 'restored-access-token',
      csrfToken: 'restored-csrf-token',
      isAuthenticated: true,
    });
  });

  it('logs out when browser session restore fails after a 401', async () => {
    vi.spyOn(axios, 'get').mockRejectedValue({
      isAxiosError: true,
      response: { status: 401 },
    });

    api.defaults.adapter = vi.fn(async (config) => Promise.reject({
      config,
      response: { status: 401 },
    }));

    await expect(api.get('/protected')).rejects.toMatchObject({ response: { status: 401 } });
    expect(useAuthStore.getState()).toMatchObject({
      accessToken: null,
      csrfToken: null,
      isAuthenticated: false,
      user: null,
    });
  });

  it('does not retry the session restore request with another restore call', async () => {
    const restoreSessionSpy = vi.spyOn(axios, 'get');
    api.defaults.adapter = vi.fn(async (config: RetryableRequestConfig) => Promise.reject({
      config,
      response: { status: 401 },
    }));

    await expect(api.get('/auth/session')).rejects.toMatchObject({ response: { status: 401 } });
    expect(restoreSessionSpy).not.toHaveBeenCalled();
  });
});
