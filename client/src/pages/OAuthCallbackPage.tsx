import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, CircularProgress, Typography, Alert } from '@mui/material';
import { useAuthStore } from '../store/authStore';
import { useVaultStore } from '../store/vaultStore';

export default function OAuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const setVaultUnlocked = useVaultStore((s) => s.setUnlocked);
  const [error, setError] = useState('');

  /* eslint-disable react-hooks/set-state-in-effect -- one-time OAuth callback processing */
  useEffect(() => {
    const accessToken = searchParams.get('accessToken');
    const refreshToken = searchParams.get('refreshToken');
    const needsVaultSetup = searchParams.get('needsVaultSetup') === 'true';
    const userId = searchParams.get('userId');
    const email = searchParams.get('email');
    const username = searchParams.get('username') || null;
    const avatarData = searchParams.get('avatarData') || null;
    const errorParam = searchParams.get('error');

    if (errorParam) {
      setError(decodeURIComponent(errorParam));
      return;
    }

    if (!accessToken || !refreshToken || !userId || !email) {
      setError('Invalid OAuth callback parameters');
      return;
    }

    const user = {
      id: userId,
      email,
      username,
      avatarData,
      vaultSetupComplete: !needsVaultSetup,
    };
    setAuth(accessToken, refreshToken, user);

    // Remove tokens from URL
    window.history.replaceState({}, '', '/oauth/callback');

    if (needsVaultSetup) {
      navigate('/oauth/vault-setup', { replace: true });
    } else {
      // Vault is NOT auto-unlocked for OAuth users — they must enter vault password
      setVaultUnlocked(false);
      navigate('/', { replace: true });
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

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
