import { useState, useEffect } from 'react';
import {
  Card, CardContent, Typography, Button, TextField, Alert, Box, Chip, Stack,
} from '@mui/material';
import {
  Email as EmailIcon,
  CheckCircle as CheckIcon,
  Error as ErrorIcon,
} from '@mui/icons-material';
import { getEmailStatus, sendTestEmail } from '../../api/admin.api';
import type { EmailStatus } from '../../api/admin.api';
import { extractApiError } from '../../utils/apiError';
import { useNotificationStore } from '../../store/notificationStore';

export default function EmailProviderSection() {
  const notify = useNotificationStore((s) => s.notify);
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [testTo, setTestTo] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getEmailStatus()
      .then(setStatus)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSendTest = async () => {
    if (!testTo) return;
    setError('');
    setSending(true);
    try {
      const result = await sendTestEmail(testTo);
      notify(result.message, 'success');
    } catch (err: unknown) {
      setError(extractApiError(err, 'Failed to send test email'));
    } finally {
      setSending(false);
    }
  };

  if (loading) return null;

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Email Provider
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Email provider configuration is managed via environment variables.
        </Typography>

        {status && (
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip
                icon={status.configured ? <CheckIcon /> : <ErrorIcon />}
                label={status.provider.toUpperCase()}
                color={status.configured ? 'success' : 'default'}
                variant="outlined"
              />
              {!status.configured && (
                <Typography variant="caption" color="text.secondary">
                  Not configured — emails are logged to console
                </Typography>
              )}
            </Stack>

            <Typography variant="body2">
              From: <code>{status.from}</code>
            </Typography>
            {status.host && (
              <Typography variant="body2">
                Host: <code>{status.host}:{status.port || 587}</code>
                {status.secure !== undefined && (
                  <> ({status.secure ? 'TLS' : 'Plain'})</>
                )}
              </Typography>
            )}

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Send Test Email
              </Typography>
              {error && (
                <Alert severity="error" sx={{ mb: 1 }}>
                  {error}
                </Alert>
              )}
              <Stack direction="row" spacing={1}>
                <TextField
                  size="small"
                  label="Recipient email"
                  type="email"
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  sx={{ flex: 1 }}
                />
                <Button
                  variant="outlined"
                  startIcon={<EmailIcon />}
                  onClick={handleSendTest}
                  disabled={sending || !testTo}
                >
                  {sending ? 'Sending...' : 'Send Test'}
                </Button>
              </Stack>
            </Box>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
