import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, CircularProgress, Typography, Alert } from '@mui/material';
import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import { useVaultStore } from '../store/vaultStore';

export default function OAuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const setVaultUnlocked = useVaultStore((s) => s.setUnlocked);
  const [error, setError] = useState('');

  useEffect(() => {
    const errorParam = searchParams.get('error');
    if (errorParam) {
      setError(decodeURIComponent(errorParam));
      return;
    }

    // New flow: exchange one-time code for token data
    const code = searchParams.get('code');
    if (code) {
      exchangeCode(code);
      return;
    }

    // Backward compat: accept tokens directly from URL params (transition period)
    const accessToken = searchParams.get('accessToken');
    const csrfToken = searchParams.get('csrfToken');
    const needsVaultSetup = searchParams.get('needsVaultSetup') === 'true';
    const userId = searchParams.get('userId');
    const email = searchParams.get('email');
    const username = searchParams.get('username') || null;
    const avatarData = searchParams.get('avatarData') || null;

    if (!accessToken || !csrfToken || !userId || !email) {
      setError('Invalid OAuth callback parameters');
      return;
    }

    completeAuth({
      accessToken, csrfToken, needsVaultSetup,
      userId, email, username, avatarData,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time OAuth callback processing on mount
  }, []);

  async function exchangeCode(code: string) {
    try {
      const { data } = await axios.post('/api/auth/oauth/exchange-code', { code });
      completeAuth({
        accessToken: data.accessToken,
        csrfToken: data.csrfToken,
        needsVaultSetup: data.needsVaultSetup,
        userId: data.userId,
        email: data.email,
        username: data.username || null,
        avatarData: data.avatarData || null,
      });
    } catch {
      setError('Failed to complete authentication. The authorization code may have expired.');
    }
  }

  function completeAuth(params: {
    accessToken: string;
    csrfToken: string;
    needsVaultSetup: boolean;
    userId: string;
    email: string;
    username: string | null;
    avatarData: string | null;
  }) {
    const user = {
      id: params.userId,
      email: params.email,
      username: params.username,
      avatarData: params.avatarData,
      vaultSetupComplete: !params.needsVaultSetup,
    };
    setAuth(params.accessToken, params.csrfToken, user);

    // Remove tokens/code from URL
    window.history.replaceState({}, '', '/oauth/callback');

    if (params.needsVaultSetup) {
      navigate('/oauth/vault-setup', { replace: true });
    } else {
      // Vault is NOT auto-unlocked for OAuth users — they must enter vault password
      setVaultUnlocked(false);
      navigate('/', { replace: true });
    }
  }

  if (error) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Alert severity="error" sx={{ maxWidth: 400 }}>
          {error}
          <Box sx={{ mt: 2 }}>
            <a href="/login">Return to login</a>
          </Box>
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 2 }}>
      <CircularProgress />
      <Typography variant="body2" color="text.secondary">
        Completing sign in...
      </Typography>
    </Box>
  );
}
