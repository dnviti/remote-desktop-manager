import { useState, useEffect } from 'react';
import { Button, Stack, Divider, Typography, CircularProgress } from '@mui/material';
import GitHubIcon from '@mui/icons-material/GitHub';
import GoogleIcon from '@mui/icons-material/Google';
import { getOAuthProviders, initiateOAuthLogin, initiateSamlLogin, OAuthProviders } from '../api/oauth.api';

function SamlIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z" />
    </svg>
  );
}

function OidcIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM15.1 8H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2z" />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

interface OAuthButtonsProps {
  mode: 'login' | 'register';
}

export default function OAuthButtons({ mode }: OAuthButtonsProps) {
  const [providers, setProviders] = useState<OAuthProviders | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getOAuthProviders()
      .then(setProviders)
      .catch(() => setProviders(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Stack alignItems="center" sx={{ my: 2 }}>
        <CircularProgress size={20} />
      </Stack>
    );
  }

  if (!providers || (!providers.google && !providers.microsoft && !providers.github && !providers.oidc && !providers.saml)) {
    return null;
  }

  const label = mode === 'login' ? 'Sign in' : 'Sign up';

  return (
    <>
      <Stack spacing={1.5} sx={{ mb: 2 }}>
        {providers.google && (
          <Button
            fullWidth
            variant="outlined"
            startIcon={<GoogleIcon />}
            onClick={() => initiateOAuthLogin('google')}
          >
            {label} with Google
          </Button>
        )}
        {providers.microsoft && (
          <Button
            fullWidth
            variant="outlined"
            startIcon={<MicrosoftIcon />}
            onClick={() => initiateOAuthLogin('microsoft')}
          >
            {label} with Microsoft
          </Button>
        )}
        {providers.github && (
          <Button
            fullWidth
            variant="outlined"
            startIcon={<GitHubIcon />}
            onClick={() => initiateOAuthLogin('github')}
          >
            {label} with GitHub
          </Button>
        )}
        {providers.oidc && (
          <Button
            fullWidth
            variant="outlined"
            startIcon={<OidcIcon />}
            onClick={() => initiateOAuthLogin('oidc')}
          >
            {label} with {providers.oidcProviderName || 'SSO'}
          </Button>
        )}
        {providers.saml && (
          <Button
            fullWidth
            variant="outlined"
            startIcon={<SamlIcon />}
            onClick={() => initiateSamlLogin()}
          >
            {label} with {providers.samlProviderName || 'SAML SSO'}
          </Button>
        )}
      </Stack>

      <Divider sx={{ mb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          or
        </Typography>
      </Divider>
    </>
  );
}
