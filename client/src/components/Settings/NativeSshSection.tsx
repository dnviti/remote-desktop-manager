import { useState, useEffect } from 'react';
import {
  Card, CardContent, Typography, Box, Alert, CircularProgress,
  Chip, Stack, TextField, IconButton, Tooltip,
} from '@mui/material';
import {
  ContentCopy as CopyIcon,
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
} from '@mui/icons-material';
import { getSshProxyStatus } from '../../api/sessions.api';
import type { SshProxyStatus } from '../../api/sessions.api';

export default function NativeSshSection() {
  const [status, setStatus] = useState<SshProxyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getSshProxyStatus()
      .then((s) => { setStatus(s); setLoading(false); })
      .catch(() => { setError('Unable to fetch SSH proxy status'); setLoading(false); });
  }, []);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (loading) {
    return (
      <Card variant="outlined">
        <CardContent sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={24} />
        </CardContent>
      </Card>
    );
  }

  const sshConfigSnippet = status ? `Host arsenale-proxy
  HostName <server-host>
  Port ${status.port}
  User <connection-id>
  # Use the proxy token as password when prompted` : '';

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
          Native SSH Access
        </Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Connect to your SSH targets using a native OpenSSH client through the Arsenale SSH proxy.
          The proxy handles authentication and credential injection transparently.
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {status && (
          <Stack spacing={2} sx={{ mt: 2 }}>
            {/* Status */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" fontWeight="bold">Status:</Typography>
              {status.enabled ? (
                <Chip
                  icon={status.listening ? <CheckCircleIcon /> : <CancelIcon />}
                  label={status.listening ? 'Running' : 'Enabled (not listening)'}
                  color={status.listening ? 'success' : 'warning'}
                  size="small"
                />
              ) : (
                <Chip
                  icon={<CancelIcon />}
                  label="Disabled"
                  color="default"
                  size="small"
                />
              )}
            </Box>

            {/* Port */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" fontWeight="bold">Proxy Port:</Typography>
              <Typography variant="body2">{status.port}</Typography>
            </Box>

            {/* Active Sessions */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" fontWeight="bold">Active Proxy Sessions:</Typography>
              <Typography variant="body2">{status.activeSessions}</Typography>
            </Box>

            {/* Auth Methods */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography variant="body2" fontWeight="bold">Auth Methods:</Typography>
              {status.allowedAuthMethods.map((method) => (
                <Chip key={method} label={method} size="small" variant="outlined" />
              ))}
            </Box>

            {/* SSH Config Snippet */}
            {status.enabled && (
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Typography variant="body2" fontWeight="bold">SSH Config Snippet:</Typography>
                  <Tooltip title={copied ? 'Copied!' : 'Copy to clipboard'}>
                    <IconButton
                      size="small"
                      onClick={() => handleCopy(sshConfigSnippet)}
                    >
                      <CopyIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
                <TextField
                  fullWidth
                  multiline
                  rows={5}
                  value={sshConfigSnippet}
                  slotProps={{ input: { readOnly: true } }}
                  sx={{ mt: 1, '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: '0.85rem' } }}
                />
              </Box>
            )}

            {/* Connection Instructions */}
            {status.enabled && (
              <Alert severity="info" sx={{ mt: 1 }}>
                <Typography variant="body2">
                  <strong>How to connect:</strong>
                </Typography>
                <Typography variant="body2" component="ol" sx={{ pl: 2, mt: 0.5 }}>
                  <li>Generate a proxy token from the connection context menu or via the API.</li>
                  <li>Use the token as the password when connecting through the SSH proxy.</li>
                  <li>The proxy will authenticate you, resolve credentials from the vault, and forward your session.</li>
                </Typography>
              </Alert>
            )}

            {!status.enabled && (
              <Alert severity="info" sx={{ mt: 1 }}>
                The SSH proxy is currently disabled. To enable it, set <code>SSH_PROXY_ENABLED=true</code> in your
                environment variables and restart the server.
              </Alert>
            )}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
