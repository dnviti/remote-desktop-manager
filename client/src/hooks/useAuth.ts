import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { refreshApi } from '../api/auth.api';

export function useAuth() {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const accessToken = useAuthStore((s) => s.accessToken);
  const setAccessToken = useAuthStore((s) => s.setAccessToken);
  const logout = useAuthStore((s) => s.logout);
  const [loading, setLoading] = useState(isAuthenticated && !accessToken);

  useEffect(() => {
    if (isAuthenticated && !accessToken) {
      refreshApi()
        .then((data) => {
          setAccessToken(data.accessToken);
          if (data.csrfToken) useAuthStore.getState().setCsrfToken(data.csrfToken);
          if (data.user) useAuthStore.getState().updateUser(data.user);
        })
        .catch(() => {
          logout();
          navigate('/login');
        })
        .finally(() => {
          setLoading(false);
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time token refresh on mount
  }, []);

  return { isAuthenticated, loading };
}
