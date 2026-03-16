import { useState, useEffect } from 'react';
import {
  Card, CardContent, Typography, Button, TextField, Alert, Box, Stack, Chip,
} from '@mui/material';
import { QRCodeSVG } from 'qrcode.react';
import { setup2FA, verify2FA, disable2FA, get2FAStatus } from '../../api/twofa.api';
import { extractApiError } from '../../utils/apiError';
import { useNotificationStore } from '../../store/notificationStore';

type Phase = 'idle' | 'setup' | 'disabling';

export default function TwoFactorSection() {
  const notify = useNotificationStore((s) => s.notify);
  const [enabled, setEnabled] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>('idle');
  const [otpauthUri, setOtpauthUri] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    get2FAStatus()
      .then(({ enabled: e }) => setEnabled(e))
      .catch(() => {})
      .finally(() => setStatusLoading(false));
  }, []);

  const handleStartSetup = async () => {
    setError('');
    setLoading(true);
    try {
      const result = await setup2FA();
      setSecret(result.secret);
      setOtpauthUri(result.otpauthUri);
      setPhase('setup');
    } catch {
      setError('Failed to initialize 2FA setup');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyAndEnable = async () => {
    setError('');
    setLoading(true);
    try {
      await verify2FA(code);
      setEnabled(true);
      notify('Two-factor authentication enabled successfully', 'success');
      setPhase('idle');
      setCode('');
      setSecret('');
      setOtpauthUri('');
    } catch (err: unknown) {
      setError(extractApiError(err, 'Invalid code'));
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async () => {
    setError('');
    setLoading(true);
    try {
      await disable2FA(disableCode);
      setEnabled(false);
      notify('Two-factor authentication disabled', 'success');
      setPhase('idle');
      setDisableCode('');
    } catch (err: unknown) {
      setError(extractApiError(err, 'Invalid code'));
    } finally {
      setLoading(false);
    }
  };

  const handleCancelSetup = () => {
    setPhase('idle');
    setCode('');
    setSecret('');
    setOtpauthUri('');
    setError('');
  };

  if (statusLoading) return null;

  return (
    <Card>
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          <Typography variant="h6">Two-Factor Authentication</Typography>
          <Chip
            label={enabled ? 'Enabled' : 'Disabled'}
            color={enabled ? 'success' : 'default'}
            size="small"
          />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Add an extra layer of security using an authenticator app (Google Authenticator, Authy, etc.)
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {/* State: 2FA disabled, idle */}
        {!enabled && phase === 'idle' && (
          <Button
            variant="contained"
            color="success"
            disabled={loading}
            onClick={handleStartSetup}
          >
            {loading ? 'Setting up...' : 'Enable Two-Factor Authentication'}
          </Button>
        )}

        {/* State: Setup in progress */}
        {phase === 'setup' && (
          <Box>
            <Typography variant="body2" sx={{ mb: 2 }}>
              1. Scan this QR code with your authenticator app:
            </Typography>
            <Box sx={{
              p: 2,
              bgcolor: '#ffffff',
              borderRadius: 1,
              display: 'inline-block',
              mb: 2,
            }}>
              <QRCodeSVG value={otpauthUri} size={200} />
            </Box>

            <Typography variant="body2" sx={{ mb: 1 }}>
              2. Or enter this code manually:
            </Typography>
            <TextField
              fullWidth
              value={secret}
              size="small"
              slotProps={{ input: { readOnly: true } }}
              sx={{ mb: 2, fontFamily: 'monospace' }}
            />

            <Typography variant="body2" sx={{ mb: 1 }}>
              3. Enter the 6-digit code from your app to confirm:
            </Typography>
            <TextField
              fullWidth
              label="6-digit code"
              type="text"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              size="small"
              placeholder="000000"
              slotProps={{ htmlInput: { maxLength: 6 } }}
              sx={{ mb: 2 }}
            />

            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                disabled={loading || code.length !== 6}
                onClick={handleVerifyAndEnable}
              >
                {loading ? 'Verifying...' : 'Confirm & Enable'}
              </Button>
              <Button
                variant="outlined"
                disabled={loading}
                onClick={handleCancelSetup}
              >
                Cancel
              </Button>
            </Stack>
          </Box>
        )}

        {/* State: 2FA enabled, idle */}
        {enabled && phase === 'idle' && (
          <Box>
            <Button
              variant="outlined"
              color="warning"
              onClick={() => setPhase('disabling')}
            >
              Disable Two-Factor Authentication
            </Button>
          </Box>
        )}

        {/* State: Disabling */}
        {enabled && phase === 'disabling' && (
          <Box>
            <Typography variant="body2" sx={{ mb: 1 }}>
              Enter your current authenticator code to disable 2FA:
            </Typography>
            <TextField
              fullWidth
              label="6-digit code"
              type="text"
              inputMode="numeric"
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              size="small"
              placeholder="000000"
              slotProps={{ htmlInput: { maxLength: 6 } }}
              sx={{ mb: 2 }}
            />
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                color="warning"
                disabled={loading || disableCode.length !== 6}
                onClick={handleDisable}
              >
                {loading ? 'Verifying...' : 'Disable 2FA'}
              </Button>
              <Button
                variant="outlined"
                disabled={loading}
                onClick={() => { setPhase('idle'); setDisableCode(''); setError(''); }}
              >
                Cancel
              </Button>
            </Stack>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
