import { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Box, Alert,
  FormControl, InputLabel, Select, MenuItem, FormControlLabel, Checkbox, Typography,
  IconButton, InputAdornment, Paper, Stack,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useTenantStore } from '../../store/tenantStore';
import { getEmailStatus } from '../../api/admin.api';
import type { CreateUserResult } from '../../api/tenant.api';

interface CreateUserDialogProps {
  open: boolean;
  onClose: () => void;
}

function generatePassword(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*';
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length]).join('');
}

export default function CreateUserDialog({ open, onClose }: CreateUserDialogProps) {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'MEMBER'>('MEMBER');
  const [sendWelcomeEmail, setSendWelcomeEmail] = useState(false);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CreateUserResult | null>(null);
  const [copied, setCopied] = useState('');
  const createUser = useTenantStore((s) => s.createUser);

  useEffect(() => {
    if (open) {
      getEmailStatus()
        .then((s) => setEmailConfigured(s.configured))
        .catch(() => setEmailConfigured(false));
    }
  }, [open]);

  const handleGenerate = () => {
    const pw = generatePassword();
    setPassword(pw);
    setConfirmPassword(pw);
  };

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };

  const handleSubmit = async () => {
    setError('');
    if (!email.trim()) { setError('Email is required'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Please enter a valid email address'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }

    setLoading(true);
    try {
      const res = await createUser({
        email: email.trim(),
        username: username.trim() || undefined,
        password,
        role,
        sendWelcomeEmail: emailConfigured ? sendWelcomeEmail : false,
      });
      setResult(res);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to create user';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setEmail('');
    setUsername('');
    setPassword('');
    setConfirmPassword('');
    setRole('MEMBER');
    setSendWelcomeEmail(false);
    setError('');
    setResult(null);
    setCopied('');
    onClose();
  };

  if (result) {
    return (
      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>User Created Successfully</DialogTitle>
        <DialogContent>
          <Alert severity="success" sx={{ mb: 2 }}>
            Account created for {result.user.email}
          </Alert>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack spacing={1.5}>
              <Box>
                <Typography variant="caption" color="text.secondary">Email</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', flex: 1 }}>{result.user.email}</Typography>
                  <IconButton size="small" onClick={() => handleCopy(result.user.email, 'email')}>
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Box>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Password</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', flex: 1 }}>{password}</Typography>
                  <IconButton size="small" onClick={() => handleCopy(password, 'password')}>
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Box>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Recovery Key (show once)</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', flex: 1, wordBreak: 'break-all' }}>{result.recoveryKey}</Typography>
                  <IconButton size="small" onClick={() => handleCopy(result.recoveryKey, 'recovery')}>
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Box>
              </Box>
              {copied && (
                <Typography variant="caption" color="success.main">
                  Copied {copied}!
                </Typography>
              )}
            </Stack>
          </Paper>
          <Alert severity="warning" sx={{ mt: 2 }}>
            Save these credentials now. The recovery key will not be shown again.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} variant="contained">Done</Button>
        </DialogActions>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>Create User</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField
            label="Email Address"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            fullWidth
            required
            autoFocus
          />
          <TextField
            label="Username (optional)"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            fullWidth
          />
          <TextField
            label="Password"
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            fullWidth
            required
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={handleGenerate} title="Generate password">
                      <RefreshIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
          <TextField
            label="Confirm Password"
            type="text"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            fullWidth
            required
            error={!!confirmPassword && password !== confirmPassword}
            helperText={confirmPassword && password !== confirmPassword ? 'Passwords do not match' : ''}
          />
          <FormControl fullWidth>
            <InputLabel>Role</InputLabel>
            <Select
              value={role}
              label="Role"
              onChange={(e) => setRole(e.target.value as 'ADMIN' | 'MEMBER')}
            >
              <MenuItem value="MEMBER">Member</MenuItem>
              <MenuItem value="ADMIN">Admin</MenuItem>
            </Select>
          </FormControl>
          {emailConfigured && (
            <FormControlLabel
              control={
                <Checkbox
                  checked={sendWelcomeEmail}
                  onChange={(e) => setSendWelcomeEmail(e.target.checked)}
                />
              }
              label="Send welcome email with credentials"
            />
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button onClick={handleSubmit} variant="contained" disabled={loading}>
          {loading ? 'Creating...' : 'Create User'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
