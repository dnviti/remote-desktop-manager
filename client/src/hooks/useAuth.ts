import axios from 'axios';
import { useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { restoreSessionApi } from '../api/auth.api';

export function useAuth() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const accessToken = useAuthStore((s) => s.accessToken);
  const applySession = useAuthStore((s) => s.applySession);
  const logout = useAuthStore((s) => s.logout);
  const [loading, setLoading] = useState(!accessToken);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (accessToken) {
      return;
    }

    let cancelled = false;
    let retryTimer: number | undefined;

    restoreSessionApi()
      .then((data) => {
        if (cancelled) return;
        applySession(data.accessToken, data.csrfToken, data.user);
        setLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          if (status === 401 || status === 403) {
            logout();
            setLoading(false);
            return;
          }
        }
        retryTimer = window.setTimeout(() => {
          setAttempt((value) => value + 1);
        }, 2000);
      });

    return () => {
      cancelled = true;
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [accessToken, applySession, attempt, logout]);

  return { isAuthenticated: isAuthenticated || Boolean(accessToken), loading };
}
