import { useState, useEffect } from 'react';
import {
  Card, CardContent, Typography, Chip, Stack, Alert,
} from '@mui/material';
import {
  CheckCircle as CheckIcon,
  Block as BlockIcon,
} from '@mui/icons-material';
import { getAuthProviderDetails } from '../../api/admin.api';
import type { AuthProviderDetail } from '../../api/admin.api';
import { extractApiError } from '../../utils/apiError';

export default function OAuthProvidersAdminSection() {
  const [providers, setProviders] = useState<AuthProviderDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    getAuthProviderDetails()
      .then(setProviders)
      .catch((err: unknown) => {
        setError(extractApiError(err, 'Failed to load authentication providers'));
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Authentication Providers
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          OAuth and SSO provider configuration is managed via environment variables.
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {providers.length > 0 && (
          <Stack spacing={1}>
            {providers.map((row) => (
              <Stack key={row.key} direction="row" spacing={1} alignItems="center">
                <Typography variant="body2" sx={{ minWidth: 80 }}>
                  {row.label}
                </Typography>
                <Chip
                  icon={row.enabled ? <CheckIcon /> : <BlockIcon />}
                  label={
                    row.enabled
                      ? row.providerName
                        ? `Enabled — ${row.providerName}`
                        : 'Enabled'
                      : 'Disabled'
                  }
                  color={row.enabled ? 'success' : 'default'}
                  variant="outlined"
                  size="small"
                />
              </Stack>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
