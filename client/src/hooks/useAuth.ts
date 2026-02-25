import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { refreshApi } from '../api/auth.api';

export function useAuth() {
  const navigate = useNavigate();
  const { isAuthenticated, refreshToken, setAccessToken, logout } = useAuthStore();

  useEffect(() => {
    if (!isAuthenticated && refreshToken) {
      refreshApi(refreshToken)
        .then((data) => setAccessToken(data.accessToken))
        .catch(() => {
          logout();
          navigate('/login');
        });
    }
  }, []);

  return { isAuthenticated };
}
