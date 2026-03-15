import { useState, useEffect } from 'react';
import {
  Card, CardContent, Typography, Button, Alert, Box, Chip, Stack,
} from '@mui/material';
import {
  CheckCircle as CheckIcon,
  Security as SecurityIcon,
  OpenInNew as OpenInNewIcon,
} from '@mui/icons-material';
import { getAuthProviderDetails } from '../../api/admin.api';
import { extractApiError } from '../../utils/apiError';

export default function SamlConfigSection() {
  const [enabled, setEnabled] = useState(false);
  const [providerName, setProviderName] = useState('SAML');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    getAuthProviderDetails()
      .then((providers) => {
        const saml = providers.find((p) => p.key === 'saml');
        setEnabled(!!saml?.enabled);
        if (saml?.providerName) {
          setProviderName(saml.providerName);
        }
      })
      .catch((err: unknown) => {
        setError(extractApiError(err, 'Failed to load SAML configuration'));
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (!enabled && !error) return null;

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
            <SecurityIcon fontSize="small" />
            SAML Single Sign-On
          </Box>
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          SAML configuration is managed via environment variables.
        </Typography>

        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}

          {enabled && (
            <>
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip
                  icon={<CheckIcon />}
                  label={providerName}
                  color="success"
                  variant="outlined"
                />
              </Stack>

              <Box>
                <Typography variant="body2" color="text.secondary">
                  Users can authenticate via the configured SAML Identity Provider.
                  Account provisioning and attribute mapping are handled automatically
                  based on the server&apos;s environment configuration.
                </Typography>
              </Box>

              <Button
                variant="outlined"
                size="small"
                startIcon={<OpenInNewIcon />}
                href="/api/saml/metadata"
                target="_blank"
                rel="noopener noreferrer"
                sx={{ alignSelf: 'flex-start' }}
              >
                View SP Metadata
              </Button>
            </>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
