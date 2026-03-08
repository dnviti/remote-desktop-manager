import { useState, useEffect } from 'react';
import {
  Card, CardContent, Typography, Button, TextField, Alert, Box, Stack, Chip,
} from '@mui/material';
import {
  setupSmsPhone, verifySmsPhone, enableSmsMfa,
  sendSmsMfaDisableCode, disableSmsMfa, getSmsMfaStatus,
} from '../../api/smsMfa.api';

type Phase = 'idle' | 'phone-input' | 'verify-phone' | 'disabling';

export default function SmsMfaSection() {
  const [enabled, setEnabled] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>('idle');
  const [phoneInput, setPhoneInput] = useState('');
  const [code, setCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getSmsMfaStatus()
      .then((status) => {
        setEnabled(status.enabled);
        setPhoneNumber(status.phoneNumber);
      })
      .catch(() => {})
      .finally(() => setStatusLoading(false));
  }, []);

  const handleSubmitPhone = async () => {
    setError('');
    setLoading(true);
    try {
      await setupSmsPhone(phoneInput);
      setPhase('verify-phone');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to send verification code';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyAndEnable = async () => {
    setError('');
    setLoading(true);
    try {
      await verifySmsPhone(code);
      await enableSmsMfa();
      setEnabled(true);
      setSuccess('SMS MFA enabled successfully');
      setPhase('idle');
      setCode('');
      setPhoneInput('');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Invalid code';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleStartDisable = async () => {
    setError('');
    setLoading(true);
    try {
      await sendSmsMfaDisableCode();
      setPhase('disabling');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to send verification code';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async () => {
    setError('');
    setLoading(true);
    try {
      await disableSmsMfa(disableCode);
      setEnabled(false);
      setPhoneNumber(null);
      setSuccess('SMS MFA disabled');
      setPhase('idle');
      setDisableCode('');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Invalid code';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelSetup = () => {
    setPhase('idle');
    setPhoneInput('');
    setCode('');
    setError('');
  };

  if (statusLoading) return null;

  return (
    <Card>
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          <Typography variant="h6">SMS Authentication</Typography>
          <Chip
            label={enabled ? 'Enabled' : 'Disabled'}
            color={enabled ? 'success' : 'default'}
            size="small"
          />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Receive a verification code via SMS when signing in. Can be used alongside or instead of an authenticator app.
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

        {/* State: SMS MFA disabled, idle */}
        {!enabled && phase === 'idle' && (
          <Button
            variant="contained"
            color="success"
            disabled={loading}
            onClick={() => { setPhase('phone-input'); setError(''); setSuccess(''); }}
          >
            {loading ? 'Setting up...' : 'Enable SMS Authentication'}
          </Button>
        )}

        {/* State: Phone number input */}
        {phase === 'phone-input' && (
          <Box>
            <Typography variant="body2" sx={{ mb: 1 }}>
              Enter your phone number in international format:
            </Typography>
            <TextField
              fullWidth
              label="Phone Number"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              size="small"
              placeholder="+1234567890"
              helperText="E.164 format (e.g. +1234567890)"
              sx={{ mb: 2 }}
            />
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                disabled={loading || !phoneInput.match(/^\+[1-9]\d{1,14}$/)}
                onClick={handleSubmitPhone}
              >
                {loading ? 'Sending...' : 'Send Verification Code'}
              </Button>
              <Button variant="outlined" disabled={loading} onClick={handleCancelSetup}>
                Cancel
              </Button>
            </Stack>
          </Box>
        )}

        {/* State: Verify phone with code */}
        {phase === 'verify-phone' && (
          <Box>
            <Alert severity="info" sx={{ mb: 2 }}>
              A verification code has been sent to {phoneInput}
            </Alert>
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
                {loading ? 'Verifying...' : 'Verify & Enable'}
              </Button>
              <Button variant="outlined" disabled={loading} onClick={handleCancelSetup}>
                Cancel
              </Button>
            </Stack>
          </Box>
        )}

        {/* State: SMS MFA enabled, idle */}
        {enabled && phase === 'idle' && (
          <Box>
            {phoneNumber && (
              <Typography variant="body2" sx={{ mb: 2 }}>
                Phone: {phoneNumber}
              </Typography>
            )}
            <Button
              variant="outlined"
              color="warning"
              disabled={loading}
              onClick={handleStartDisable}
            >
              {loading ? 'Sending code...' : 'Disable SMS Authentication'}
            </Button>
          </Box>
        )}

        {/* State: Disabling */}
        {enabled && phase === 'disabling' && (
          <Box>
            <Alert severity="info" sx={{ mb: 2 }}>
              A verification code has been sent to your phone.
            </Alert>
            <Typography variant="body2" sx={{ mb: 1 }}>
              Enter the code to confirm disabling SMS MFA:
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
                {loading ? 'Verifying...' : 'Disable SMS MFA'}
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
