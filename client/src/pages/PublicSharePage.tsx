import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  Box, Card, CardContent, Typography, TextField, Button,
  CircularProgress, Alert, IconButton, Tooltip, Divider,
} from '@mui/material';
import {
  ContentCopy as CopyIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
} from '@mui/icons-material';
import {
  getExternalShareInfo, accessExternalShare,
} from '../api/secrets.api';
import type { ExternalShareInfo, SecretPayload } from '../api/secrets.api';
import { extractApiError } from '../utils/apiError';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';

function SensitiveValue({ value }: { value: string }) {
  const [visible, setVisible] = useState(false);
  const { copied, copy: handleCopy } = useCopyToClipboard();

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Typography
        variant="body2"
        sx={{
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          wordBreak: 'break-all',
          flex: 1,
          color: visible ? '#f4f4f5' : '#a1a1aa',
        }}
      >
        {visible ? value : '\u2022'.repeat(Math.min(value.length, 24))}
      </Typography>
      <Tooltip title={visible ? 'Hide' : 'Reveal'}>
        <IconButton size="small" onClick={() => setVisible(!visible)} sx={{ color: '#a1a1aa' }}>
          {visible ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
        </IconButton>
      </Tooltip>
      <Tooltip title={copied ? 'Copied!' : 'Copy'}>
        <IconButton size="small" onClick={() => handleCopy(value)} sx={{ color: '#a1a1aa' }}>
          <CopyIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

function PlainValue({ value }: { value: string }) {
  const { copied, copy: handleCopy } = useCopyToClipboard();

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Typography variant="body2" sx={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace", wordBreak: 'break-all', flex: 1, color: '#f4f4f5' }}>
        {value}
      </Typography>
      <Tooltip title={copied ? 'Copied!' : 'Copy'}>
        <IconButton size="small" onClick={() => handleCopy(value)} sx={{ color: '#a1a1aa' }}>
          <CopyIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

function SecretField({ label, value, sensitive }: { label: string; value?: string; sensitive?: boolean }) {
  if (!value) return null;
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography variant="caption" sx={{ color: '#a1a1aa' }}>{label}</Typography>
      {sensitive ? <SensitiveValue value={value} /> : <PlainValue value={value} />}
    </Box>
  );
}

function SecretData({ data }: { data: SecretPayload }) {
  switch (data.type) {
    case 'LOGIN':
      return (
        <>
          <SecretField label="Username" value={data.username} />
          <SecretField label="Password" value={data.password} sensitive />
          <SecretField label="URL" value={data.url} />
          <SecretField label="Notes" value={data.notes} />
        </>
      );
    case 'SSH_KEY':
      return (
        <>
          <SecretField label="Username" value={data.username} />
          <SecretField label="Private Key" value={data.privateKey} sensitive />
          <SecretField label="Public Key" value={data.publicKey} />
          <SecretField label="Passphrase" value={data.passphrase} sensitive />
          <SecretField label="Algorithm" value={data.algorithm} />
          <SecretField label="Notes" value={data.notes} />
        </>
      );
    case 'CERTIFICATE':
      return (
        <>
          <SecretField label="Certificate" value={data.certificate} sensitive />
          <SecretField label="Private Key" value={data.privateKey} sensitive />
          <SecretField label="Chain" value={data.chain} />
          <SecretField label="Passphrase" value={data.passphrase} sensitive />
          <SecretField label="Notes" value={data.notes} />
        </>
      );
    case 'API_KEY':
      return (
        <>
          <SecretField label="API Key" value={data.apiKey} sensitive />
          <SecretField label="Endpoint" value={data.endpoint} />
          <SecretField label="Notes" value={data.notes} />
        </>
      );
    case 'SECURE_NOTE':
      return <SecretField label="Content" value={data.content} />;
    default:
      return null;
  }
}

export default function PublicSharePage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<ExternalShareInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessing, setAccessing] = useState(false);
  const [error, setError] = useState('');
  const [pin, setPin] = useState('');
  const [data, setData] = useState<SecretPayload | null>(null);
  const [secretName, setSecretName] = useState('');

  useEffect(() => {
    if (!token) return;
    loadInfo();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const loadInfo = async () => {
    setLoading(true);
    setError('');
    try {
      const shareInfo = await getExternalShareInfo(token as string);
      setInfo(shareInfo);
      // Auto-access if no PIN required and share is valid
      if (!shareInfo.hasPin && !shareInfo.isExpired && !shareInfo.isExhausted && !shareInfo.isRevoked) {
        await accessShare();
      }
    } catch (err: unknown) {
      setError(extractApiError(err, 'Share not found or no longer available'));
    } finally {
      setLoading(false);
    }
  };

  const accessShare = async (pinValue?: string) => {
    setAccessing(true);
    setError('');
    try {
      const result = await accessExternalShare(token as string, pinValue);
      setData(result.data);
      setSecretName(result.secretName);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setError(extractApiError(err, status === 403 ? 'Invalid PIN' : 'Failed to access share'));
    } finally {
      setAccessing(false);
    }
  };

  const handlePinSubmit = () => {
    if (!/^\d{4,8}$/.test(pin)) {
      setError('PIN must be 4-8 digits');
      return;
    }
    accessShare(pin);
  };

  const isUnavailable = info && (info.isExpired || info.isExhausted || info.isRevoked);
  const unavailableReason = info?.isRevoked
    ? 'This share link has been revoked.'
    : info?.isExpired
      ? 'This share link has expired.'
      : info?.isExhausted
        ? 'This share link has reached its access limit.'
        : '';

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(ellipse at 50% 0%, #161619 0%, #08080a 70%)',
        p: 2,
      }}
    >
      <Card sx={{ maxWidth: 500, width: '100%', bgcolor: '#0f0f12', border: '1px solid rgba(35,35,40,0.6)', borderRadius: 4 }}>
        <CardContent sx={{ p: 3 }}>
          <Typography variant="h6" align="center" sx={{ mb: 2, fontFamily: "'Playfair Display', 'Georgia', serif", color: '#f4f4f5', fontWeight: 600 }}>
            Arsenale
          </Typography>
          <Divider sx={{ mb: 2, borderColor: 'rgba(35,35,40,0.6)' }} />

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress sx={{ color: '#00e5a0' }} />
            </Box>
          ) : error && !data && !info ? (
            <Alert severity="error">{error}</Alert>
          ) : isUnavailable ? (
            <Alert severity="warning">{unavailableReason}</Alert>
          ) : data ? (
            <>
              <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 600, color: '#f4f4f5' }}>
                {secretName}
              </Typography>
              <SecretData data={data} />
              <Alert severity="info" sx={{ mt: 2 }}>
                This shared data may expire or become unavailable. Save what you need.
              </Alert>
            </>
          ) : info?.hasPin ? (
            <>
              <Typography variant="subtitle1" sx={{ mb: 1, color: '#f4f4f5' }}>
                {info.secretName}
              </Typography>
              <Typography variant="body2" sx={{ mb: 2, color: '#a1a1aa' }}>
                This secret is protected with a PIN. Enter the PIN to access it.
              </Typography>
              {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
              <TextField
                label="PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                size="small"
                fullWidth
                placeholder="Enter PIN"
                sx={{
                  mb: 2,
                  '& .MuiOutlinedInput-root': {
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    color: '#f4f4f5',
                    '& fieldset': { borderColor: 'rgba(35,35,40,0.6)' },
                    '&:hover fieldset': { borderColor: '#a1a1aa' },
                    '&.Mui-focused fieldset': { borderColor: '#00e5a0' },
                  },
                  '& .MuiInputLabel-root': { color: '#a1a1aa' },
                  '& .MuiInputLabel-root.Mui-focused': { color: '#00e5a0' },
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') handlePinSubmit(); }}
              />
              <Button
                variant="contained"
                fullWidth
                onClick={handlePinSubmit}
                disabled={accessing}
                sx={{
                  bgcolor: '#00e5a0',
                  color: '#08080a',
                  fontWeight: 600,
                  '&:hover': { bgcolor: '#00cc8e' },
                  '&.Mui-disabled': { bgcolor: 'rgba(0,229,160,0.3)', color: '#08080a' },
                }}
              >
                {accessing ? 'Decrypting...' : 'Decrypt'}
              </Button>
            </>
          ) : (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress sx={{ color: '#00e5a0' }} />
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
