import { useState, useEffect, useCallback } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import {
  Box, Card, CardContent, TextField, Button, Typography, Alert, Link,
  CircularProgress, Collapse,
} from '@mui/material';
import {
  validateResetTokenApi,
  requestResetSmsCodeApi,
  completePasswordResetApi,
} from '../api/passwordReset.api';
import { extractApiError } from '../utils/apiError';
import PasswordStrengthMeter from '../components/common/PasswordStrengthMeter';
import RecoveryKeyConfirmDialog from '../components/common/RecoveryKeyConfirmDialog';

type Step = 'validating' | 'sms' | 'form' | 'recovery-key' | 'success' | 'error';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [step, setStep] = useState<Step>('validating');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // SMS state
  const [requiresSms, setRequiresSms] = useState(false);
  const [maskedPhone, setMaskedPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [smsSent, setSmsSent] = useState(false);
  const [smsSending, setSmsSending] = useState(false);

  // Form state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [hasRecoveryKey, setHasRecoveryKey] = useState(false);
  const [showRecoveryInput, setShowRecoveryInput] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState('');

  // Success state
  const [vaultPreserved, setVaultPreserved] = useState(false);
  const [newRecoveryKey, setNewRecoveryKey] = useState('');

  const validateToken = useCallback(async () => {
    if (!token) {
      setError('No reset token provided.');
      setStep('error');
      return;
    }
    try {
      const result = await validateResetTokenApi(token);
      if (!result.valid) {
        setError('This reset link is invalid or has expired.');
        setStep('error');
        return;
      }
      setRequiresSms(result.requiresSmsVerification);
      setMaskedPhone(result.maskedPhone || '');
      setHasRecoveryKey(result.hasRecoveryKey);

      if (result.requiresSmsVerification) {
        setStep('sms');
      } else {
        setStep('form');
      }
    } catch {
      setError('This reset link is invalid or has expired.');
      setStep('error');
    }
  }, [token]);

  useEffect(() => {
    validateToken();
  }, [validateToken]);

  const handleSendSms = async () => {
    setSmsSending(true);
    setError('');
    try {
      await requestResetSmsCodeApi(token);
      setSmsSent(true);
    } catch (err: unknown) {
      setError(extractApiError(err, 'Failed to send SMS code'));
    } finally {
      setSmsSending(false);
    }
  };

  const handleSmsVerified = () => {
    setStep('form');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (newPassword.length < 10) {
      setError('Password must be at least 10 characters.');
      return;
    }

    setLoading(true);
    try {
      const result = await completePasswordResetApi({
        token,
        newPassword,
        smsCode: requiresSms ? smsCode : undefined,
        recoveryKey: recoveryKey || undefined,
      });
      setVaultPreserved(result.vaultPreserved);
      setNewRecoveryKey(result.newRecoveryKey || '');
      if (result.newRecoveryKey) {
        setStep('recovery-key');
      } else {
        setStep('success');
      }
    } catch (err: unknown) {
      setError(extractApiError(err, 'Password reset failed. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: '#08080a',
        background: 'radial-gradient(ellipse at 50% 0%, rgba(0,229,160,0.04) 0%, #08080a 70%)',
      }}
    >
      <Card sx={{
        width: 440,
        maxWidth: '90vw',
        bgcolor: '#0f0f12',
        border: '1px solid rgba(35,35,40,0.6)',
        borderRadius: 4,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}>
        <CardContent sx={{ p: 4 }}>
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
            <Box sx={{ width: 32, height: 3, borderRadius: 1, bgcolor: '#00e5a0' }} />
          </Box>
          <Typography variant="h5" gutterBottom align="center" sx={{
            fontFamily: '"Instrument Serif", serif',
            fontSize: '1.75rem',
            color: '#f4f4f5',
          }}>
            Reset Password
          </Typography>

          {step === 'validating' && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress sx={{ color: '#00e5a0' }} />
            </Box>
          )}

          {step === 'error' && (
            <>
              <Alert severity="error" sx={{ mb: 2, bgcolor: 'rgba(239,68,68,0.08)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.15)', '& .MuiAlert-icon': { color: '#fca5a5' } }}>{error}</Alert>
              <Typography variant="body2" align="center" sx={{ color: '#a1a1aa' }}>
                <Link component={RouterLink} to="/forgot-password" sx={{ color: '#00e5a0', '&:hover': { color: '#00cc8e' } }}>Request a new reset link</Link>
              </Typography>
            </>
          )}

          {step === 'sms' && (
            <Box>
              <Typography variant="body2" align="center" mb={2} sx={{ color: '#a1a1aa' }}>
                Your account has SMS verification enabled. Please verify your phone number to continue.
              </Typography>
              {error && <Alert severity="error" sx={{ mb: 2, bgcolor: 'rgba(239,68,68,0.08)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.15)', '& .MuiAlert-icon': { color: '#fca5a5' } }}>{error}</Alert>}

              {!smsSent ? (
                <>
                  <Alert severity="info" sx={{ mb: 2, bgcolor: 'rgba(0,229,160,0.08)', color: '#00e5a0', border: '1px solid rgba(0,229,160,0.15)', '& .MuiAlert-icon': { color: '#00e5a0' } }}>
                    A verification code will be sent to {maskedPhone}.
                  </Alert>
                  <Button
                    fullWidth
                    variant="contained"
                    onClick={handleSendSms}
                    disabled={smsSending}
                    sx={{ mb: 1, bgcolor: '#00e5a0', color: '#08080a', fontWeight: 600, '&:hover': { bgcolor: '#00cc8e' }, '&.Mui-disabled': { bgcolor: 'rgba(0,229,160,0.3)', color: 'rgba(8,8,10,0.5)' } }}
                  >
                    {smsSending ? 'Sending...' : 'Send SMS Code'}
                  </Button>
                </>
              ) : (
                <>
                  <Alert severity="info" sx={{ mb: 2, bgcolor: 'rgba(0,229,160,0.08)', color: '#00e5a0', border: '1px solid rgba(0,229,160,0.15)', '& .MuiAlert-icon': { color: '#00e5a0' } }}>
                    A verification code has been sent to {maskedPhone}.
                  </Alert>
                  <TextField
                    fullWidth
                    label="SMS Code"
                    type="text"
                    inputMode="numeric"
                    value={smsCode}
                    onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    margin="normal"
                    required
                    autoFocus
                    placeholder="000000"
                    slotProps={{ htmlInput: { maxLength: 6 } }}
                    sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#161619', '& fieldset': { borderColor: 'rgba(35,35,40,0.6)' }, '&:hover fieldset': { borderColor: 'rgba(0,229,160,0.3)' }, '&.Mui-focused fieldset': { borderColor: '#00e5a0' } }, '& .MuiInputLabel-root': { color: '#a1a1aa' }, '& .MuiOutlinedInput-input': { color: '#f4f4f5' } }}
                  />
                  <Button
                    fullWidth
                    variant="contained"
                    onClick={handleSmsVerified}
                    disabled={smsCode.length !== 6}
                    sx={{ mt: 1, mb: 1, bgcolor: '#00e5a0', color: '#08080a', fontWeight: 600, '&:hover': { bgcolor: '#00cc8e' }, '&.Mui-disabled': { bgcolor: 'rgba(0,229,160,0.3)', color: 'rgba(8,8,10,0.5)' } }}
                  >
                    Continue
                  </Button>
                  <Button
                    fullWidth
                    variant="text"
                    size="small"
                    onClick={handleSendSms}
                    disabled={smsSending}
                    sx={{ color: '#00e5a0', '&:hover': { color: '#00cc8e', bgcolor: 'rgba(0,229,160,0.08)' } }}
                  >
                    Resend Code
                  </Button>
                </>
              )}
            </Box>
          )}

          {step === 'form' && (
            <Box component="form" onSubmit={handleSubmit}>
              <Typography variant="body2" align="center" mb={2} sx={{ color: '#a1a1aa' }}>
                Enter your new password.
              </Typography>
              {error && <Alert severity="error" sx={{ mb: 2, bgcolor: 'rgba(239,68,68,0.08)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.15)', '& .MuiAlert-icon': { color: '#fca5a5' } }}>{error}</Alert>}
              <TextField
                fullWidth
                label="New Password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                margin="normal"
                required
                autoFocus
                helperText="Min 10 characters"
                sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#161619', '& fieldset': { borderColor: 'rgba(35,35,40,0.6)' }, '&:hover fieldset': { borderColor: 'rgba(0,229,160,0.3)' }, '&.Mui-focused fieldset': { borderColor: '#00e5a0' } }, '& .MuiInputLabel-root': { color: '#a1a1aa' }, '& .MuiOutlinedInput-input': { color: '#f4f4f5' }, '& .MuiFormHelperText-root': { color: '#a1a1aa' } }}
              />
              <PasswordStrengthMeter password={newPassword} />
              <TextField
                fullWidth
                label="Confirm New Password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                margin="normal"
                required
                sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#161619', '& fieldset': { borderColor: 'rgba(35,35,40,0.6)' }, '&:hover fieldset': { borderColor: 'rgba(0,229,160,0.3)' }, '&.Mui-focused fieldset': { borderColor: '#00e5a0' } }, '& .MuiInputLabel-root': { color: '#a1a1aa' }, '& .MuiOutlinedInput-input': { color: '#f4f4f5' } }}
              />

              {hasRecoveryKey && (
                <Box sx={{ mt: 1 }}>
                  <Button
                    variant="text"
                    size="small"
                    onClick={() => setShowRecoveryInput(!showRecoveryInput)}
                    sx={{ textTransform: 'none', color: '#00e5a0', '&:hover': { color: '#00cc8e', bgcolor: 'rgba(0,229,160,0.08)' } }}
                  >
                    {showRecoveryInput ? 'Hide recovery key input' : 'I have a vault recovery key'}
                  </Button>
                  <Collapse in={showRecoveryInput}>
                    <Alert severity="info" sx={{ mt: 1, mb: 1, bgcolor: 'rgba(0,229,160,0.08)', color: '#00e5a0', border: '1px solid rgba(0,229,160,0.15)', '& .MuiAlert-icon': { color: '#00e5a0' } }}>
                      Enter your vault recovery key to preserve your saved credentials.
                      Without it, your encrypted vault data (connection passwords, secrets) will be reset.
                    </Alert>
                    <TextField
                      fullWidth
                      label="Vault Recovery Key"
                      type="text"
                      value={recoveryKey}
                      onChange={(e) => setRecoveryKey(e.target.value.trim())}
                      margin="normal"
                      placeholder="Enter your recovery key"
                      sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#161619', '& fieldset': { borderColor: 'rgba(35,35,40,0.6)' }, '&:hover fieldset': { borderColor: 'rgba(0,229,160,0.3)' }, '&.Mui-focused fieldset': { borderColor: '#00e5a0' } }, '& .MuiInputLabel-root': { color: '#a1a1aa' }, '& .MuiOutlinedInput-input': { color: '#f4f4f5' } }}
                    />
                  </Collapse>
                </Box>
              )}

              <Button
                fullWidth
                type="submit"
                variant="contained"
                disabled={loading}
                sx={{ mt: 2, mb: 1, bgcolor: '#00e5a0', color: '#08080a', fontWeight: 600, '&:hover': { bgcolor: '#00cc8e' }, '&.Mui-disabled': { bgcolor: 'rgba(0,229,160,0.3)', color: 'rgba(8,8,10,0.5)' } }}
              >
                {loading ? 'Resetting...' : 'Reset Password'}
              </Button>
            </Box>
          )}

          {step === 'success' && (
            <>
              <Alert severity="success" sx={{ mb: 2, bgcolor: 'rgba(0,229,160,0.08)', color: '#00e5a0', border: '1px solid rgba(0,229,160,0.15)', '& .MuiAlert-icon': { color: '#00e5a0' } }}>
                Your password has been reset successfully.
              </Alert>
              {vaultPreserved ? (
                <Alert severity="info" sx={{ mb: 2, bgcolor: 'rgba(0,229,160,0.08)', color: '#00e5a0', border: '1px solid rgba(0,229,160,0.15)', '& .MuiAlert-icon': { color: '#00e5a0' } }}>
                  Your vault data has been preserved.
                </Alert>
              ) : (
                <Alert severity="warning" sx={{ mb: 2, bgcolor: 'rgba(234,179,8,0.08)', color: '#fbbf24', border: '1px solid rgba(234,179,8,0.15)', '& .MuiAlert-icon': { color: '#fbbf24' } }}>
                  Your vault has been reset. Previously saved connection passwords and secrets have been cleared.
                </Alert>
              )}
              <Typography variant="body2" align="center" sx={{ color: '#a1a1aa' }}>
                <Link component={RouterLink} to="/login?passwordReset=true" sx={{ color: '#00e5a0', '&:hover': { color: '#00cc8e' } }}>Go to Sign In</Link>
              </Typography>
            </>
          )}

          <RecoveryKeyConfirmDialog
            open={step === 'recovery-key'}
            recoveryKey={newRecoveryKey}
            onConfirmed={() => { setNewRecoveryKey(''); setStep('success'); }}
          />
        </CardContent>
      </Card>
    </Box>
  );
}
