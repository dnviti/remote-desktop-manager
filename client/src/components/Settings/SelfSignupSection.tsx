import { useState, useEffect } from 'react';
import {
  Card, CardContent, Typography, Switch, FormControlLabel, Alert, CircularProgress, Box,
} from '@mui/material';
import { getAppConfig, setSelfSignup } from '../../api/admin.api';

export default function SelfSignupSection() {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [envLocked, setEnvLocked] = useState(false);

  useEffect(() => {
    getAppConfig()
      .then((cfg) => { setEnabled(cfg.selfSignupEnabled); setEnvLocked(cfg.selfSignupEnvLocked); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleToggle = async () => {
    const newValue = !enabled;
    setSaving(true);
    setError('');
    try {
      await setSelfSignup(newValue);
      setEnabled(newValue);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to update setting';
      setError(msg);
    } finally {
      setSaving(false);
    }
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

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
          Self-Registration
        </Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <FormControlLabel
              control={
                <Switch
                  checked={enabled}
                  onChange={handleToggle}
                  disabled={saving || envLocked}
                />
              }
              label="Allow new users to register themselves"
            />
            <Typography variant="body2" color="text.secondary" sx={{ ml: 4.5 }}>
              When disabled, only organization admins can create user accounts
            </Typography>
          </Box>
        </Box>
        {envLocked && (
          <Alert severity="info" sx={{ mt: 2 }}>
            Self-registration has been disabled by the administrator at the environment level.
            To change this setting, update the <code>SELF_SIGNUP_ENABLED</code> environment variable and restart the server.
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
