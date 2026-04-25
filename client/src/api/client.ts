import axios, { type AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../store/authStore';

const browserCsrfCookieName = 'arsenale-csrf';

function readHeaderValue(headers: AxiosHeaders | Record<string, unknown> | undefined, name: string): unknown {
  if (!headers) {
    return undefined;
  }
  if ('get' in headers && typeof headers.get === 'function') {
    return headers.get(name);
  }
  return headers[name];
}

function readBrowserCookie(name: string): string | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const prefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const cookie = part.trim();
    if (cookie.startsWith(prefix)) {
      return decodeURIComponent(cookie.slice(prefix.length));
    }
  }

  return null;
}

function readBrowserCsrfToken(): string | null {
  return readBrowserCookie(browserCsrfCookieName);
}

function isSessionRestoreRequest(config?: { url?: string | undefined }): boolean {
  return config?.url === '/auth/session' || config?.url === '/api/auth/session';
}

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

// Request interceptor: attach JWT and CSRF token
api.interceptors.request.use((config) => {
  const { accessToken, csrfToken } = useAuthStore.getState();
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  // Send CSRF token on all state-changing requests (POST, PUT, PATCH, DELETE)
  const method = config.method?.toUpperCase();
  const requestCsrfToken = readBrowserCsrfToken() ?? csrfToken;
  if (requestCsrfToken && method && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    config.headers['X-CSRF-Token'] = requestCsrfToken;
  }
  return config;
});

// Session restore lock: when multiple requests get 401 simultaneously,
// only the first one restores the browser session; the rest wait for it.
let refreshPromise: Promise<string> | null = null;

export async function refreshAccessToken(): Promise<string> {
  const { isAuthenticated } = useAuthStore.getState();
  if (!isAuthenticated) {
    throw new Error('Not authenticated');
  }

  if (!refreshPromise) {
    refreshPromise = axios
      .get('/api/auth/session', {
        withCredentials: true,
      })
      .then((res) => {
        const { accessToken, csrfToken: newCsrfToken, user } = res.data;
        if (!user) {
          throw new Error('Session restore missing user payload');
        }
        useAuthStore.getState().applySession(accessToken, newCsrfToken ?? null, user);
        return accessToken as string;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

// Response interceptor: handle 401 and refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry && !isSessionRestoreRequest(originalRequest)) {
      originalRequest._retry = true;

      const { isAuthenticated } = useAuthStore.getState();
      if (isAuthenticated) {
        try {
          const accessToken = await refreshAccessToken();
          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
          return api(originalRequest);
        } catch (refreshError) {
          if (axios.isAxiosError(refreshError)) {
            const status = refreshError.response?.status;
            if (status === 401 || status === 403) {
              useAuthStore.getState().logout();
            }
          }
        }
      }
    }

    return Promise.reject(error);
  }
);

export function readCsrfTokenForBrowserRequests(): string | null {
  return readBrowserCsrfToken() ?? useAuthStore.getState().csrfToken;
}

export function readRequestHeader(config: { headers?: AxiosHeaders | Record<string, unknown> | undefined }, name: string): unknown {
  return readHeaderValue(config.headers, name);
}

export default api;
