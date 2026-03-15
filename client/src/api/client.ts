import axios from 'axios';
import { useAuthStore } from '../store/authStore';

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
  if (csrfToken && method && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    config.headers['X-CSRF-Token'] = csrfToken;
  }
  return config;
});

// Refresh lock: when multiple requests get 401 simultaneously,
// only the first one triggers a refresh; the rest wait for it.
let refreshPromise: Promise<string> | null = null;

// Response interceptor: handle 401 and refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      const { isAuthenticated, csrfToken } = useAuthStore.getState();
      if (isAuthenticated) {
        try {
          if (!refreshPromise) {
            refreshPromise = axios
              .post('/api/auth/refresh', {}, {
                withCredentials: true,
                headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
              })
              .then((res) => {
                const { accessToken, csrfToken: newCsrfToken, user } = res.data;
                useAuthStore.getState().setAccessToken(accessToken);
                if (newCsrfToken) useAuthStore.getState().setCsrfToken(newCsrfToken);
                if (user) useAuthStore.getState().updateUser(user);
                return accessToken as string;
              })
              .finally(() => {
                refreshPromise = null;
              });
          }

          const accessToken = await refreshPromise;
          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
          return api(originalRequest);
        } catch {
          useAuthStore.getState().logout();
        }
      }
    }

    return Promise.reject(error);
  }
);

export default api;
