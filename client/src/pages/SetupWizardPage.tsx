import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, TextField, Button, Typography, Alert, Paper,
  Stepper, Step, StepLabel, Switch, FormControlLabel,
  IconButton, Tooltip, Collapse, CircularProgress,
} from '@mui/material';
import {
  ContentCopy as CopyIcon,
  Download as DownloadIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
} from '@mui/icons-material';
import {
  Storage as StorageIcon,
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
} from '@mui/icons-material';
import { completeSetup, getDbStatus, type SetupCompleteData, type DbStatusResponse } from '../api/setup.api';
import { useAuthStore } from '../store/authStore';
import { useVaultStore } from '../store/vaultStore';
import PasswordStrengthMeter from '../components/common/PasswordStrengthMeter';
import { extractApiError } from '../utils/apiError';

const STEPS = ['Welcome', 'Database', 'Administrator', 'Organization', 'Settings', 'Complete'];

export default function SetupWizardPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const setVaultUnlocked = useVaultStore((s) => s.setUnlocked);

  const [activeStep, setActiveStep] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Step 1: Database
  const [dbStatus, setDbStatus] = useState<DbStatusResponse | null>(null);
  const [dbLoading, setDbLoading] = useState(false);

  const testDbConnection = async () => {
    setDbLoading(true);
    try {
      const status = await getDbStatus();
      setDbStatus(status);
    } catch {
      setDbStatus({ host: '', port: 0, database: '', connected: false, version: null });
    } finally {
      setDbLoading(false);
    }
  };

  // Step 2: Admin
  const [adminEmail, setAdminEmail] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Step 2: Organization
  const [tenantName, setTenantName] = useState('');

  // Step 3: Settings
  const [selfSignupEnabled, setSelfSignupEnabled] = useState(false);
  const [configureSmtp, setConfigureSmtp] = useState(false);
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('');
  const [smtpSecure, setSmtpSecure] = useState(false);

  // Step 4: Result
  const [recoveryKey, setRecoveryKey] = useState('');
  const [systemSecrets, setSystemSecrets] = useState<Array<{ name: string; value: string; description: string }>>([]);
  const [copied, setCopied] = useState(false);

  const handleCopyRecoveryKey = () => {
    navigator.clipboard.writeText(recoveryKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownloadRecoveryKey = () => {
    const blob = new Blob(
      [`Arsenale Recovery Key\n${'='.repeat(40)}\n\n${recoveryKey}\n\nStore this key in a safe place. It is the only way to recover your vault if you forget your password.\n`],
      { type: 'text/plain' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'arsenale-recovery-key.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const canProceed = (): boolean => {
    switch (activeStep) {
      case 0: return true; // Welcome
      case 1: return dbStatus?.connected === true; // Database
      case 2: // Admin
        return adminEmail.length > 0
          && adminPassword.length >= 10
          && adminPassword === confirmPassword;
      case 3: // Organization
        return tenantName.length > 0;
      case 4: return true; // Settings (all optional)
      default: return false;
    }
  };

  const handleNext = async () => {
    setError('');

    // On the Settings step (4), submit everything
    if (activeStep === 4) {
      setLoading(true);
      try {
        const body: SetupCompleteData = {
          admin: {
            email: adminEmail,
            password: adminPassword,
            ...(adminUsername ? { username: adminUsername } : {}),
          },
          tenant: { name: tenantName },
          settings: {
            selfSignupEnabled,
            ...(configureSmtp && smtpHost ? {
              smtp: {
                host: smtpHost,
                port: parseInt(smtpPort, 10) || 587,
                ...(smtpUser ? { user: smtpUser } : {}),
                ...(smtpPass ? { pass: smtpPass } : {}),
                ...(smtpFrom ? { from: smtpFrom } : {}),
                secure: smtpSecure,
              },
            } : {}),
          },
        };

        const result = await completeSetup(body);

        setRecoveryKey(result.recoveryKey);
        setSystemSecrets(result.systemSecrets || []);

        // Auto-login
        setAuth(result.accessToken, result.csrfToken ?? '', {
          id: result.user.id,
          email: result.user.email,
          username: result.user.username,
          avatarData: null,
          tenantId: result.tenant.id,
          tenantRole: 'OWNER',
          vaultSetupComplete: true,
        });
        setVaultUnlocked(true);

        setActiveStep(5);
      } catch (err) {
        setError(extractApiError(err, 'Setup failed. Please try again.'));
      } finally {
        setLoading(false);
      }
      return;
    }

    setActiveStep((prev) => prev + 1);
  };

  const handleBack = () => {
    setError('');
    setActiveStep((prev) => prev - 1);
  };

  const handleGetStarted = () => {
    navigate('/', { replace: true });
  };

  return (
    <Box sx={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      bgcolor: 'background.default',
      p: 2,
    }}>
      <Paper elevation={3} sx={{ maxWidth: 640, width: '100%', p: { xs: 3, sm: 4 } }}>
        <Typography variant="h4" align="center" gutterBottom sx={{ fontWeight: 700 }}>
          Arsenale Setup
        </Typography>

        <Stepper activeStep={activeStep} sx={{ mb: 4, mt: 2 }} alternativeLabel>
          {STEPS.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {/* Step 0: Welcome */}
        {activeStep === 0 && (
          <Box>
            <Typography variant="h6" gutterBottom>Welcome to Arsenale</Typography>
            <Typography variant="body1" color="text.secondary" paragraph>
              Arsenale is a secure remote access and privileged access management platform.
              This wizard will guide you through the initial setup to get your platform ready.
            </Typography>
            <Typography variant="body1" color="text.secondary" paragraph>
              Here's what we'll do:
            </Typography>
            <Typography component="ul" variant="body2" color="text.secondary" sx={{ pl: 2, '& li': { mb: 0.5 } }}>
              <li><strong>Verify database connection</strong> — confirm the PostgreSQL database is reachable</li>
              <li><strong>Create an administrator account</strong> — your first user with full platform control</li>
              <li><strong>Create an organization</strong> — a workspace for your teams, connections, and policies</li>
              <li><strong>Configure basic settings</strong> — choose who can join and optionally set up email notifications</li>
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              This wizard runs only once. After completion, you'll be logged in and ready to go.
            </Typography>
          </Box>
        )}

        {/* Step 1: Database */}
        {activeStep === 1 && (
          <Box>
            <Typography variant="h6" gutterBottom>
              <StorageIcon sx={{ verticalAlign: 'middle', mr: 1 }} />
              Database Connection
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Verify the PostgreSQL database connection. These values are configured via the DATABASE_URL environment variable.
              To change them, update your .env file and restart the server.
            </Typography>

            {dbStatus && (
              <Box sx={{ mb: 2 }}>
                <TextField label="Host" value={dbStatus.host || '(not set)'} fullWidth size="small" sx={{ mb: 1.5 }} slotProps={{ input: { readOnly: true } }} />
                <TextField label="Port" value={String(dbStatus.port)} fullWidth size="small" sx={{ mb: 1.5 }} slotProps={{ input: { readOnly: true } }} />
                <TextField label="Database" value={dbStatus.database || '(not set)'} fullWidth size="small" sx={{ mb: 1.5 }} slotProps={{ input: { readOnly: true } }} />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                  {dbStatus.connected
                    ? <><CheckCircleIcon color="success" /><Typography color="success.main">Connected</Typography></>
                    : <><CancelIcon color="error" /><Typography color="error">Connection failed</Typography></>
                  }
                </Box>
                {dbStatus.version && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                    {dbStatus.version}
                  </Typography>
                )}
              </Box>
            )}

            <Button
              variant="outlined"
              onClick={testDbConnection}
              disabled={dbLoading}
              startIcon={dbLoading ? <CircularProgress size={16} /> : <StorageIcon />}
            >
              {dbStatus ? 'Retest Connection' : 'Test Connection'}
            </Button>
          </Box>
        )}

        {/* Step 2: Administrator Account */}
        {activeStep === 2 && (
          <Box>
            <Typography variant="h6" gutterBottom>Create Administrator Account</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              This will be the first user with full platform control. You can invite more users later.
              All connection credentials will be encrypted with a key derived from this password.
            </Typography>
            <TextField
              label="Email"
              type="email"
              fullWidth
              required
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              sx={{ mb: 2 }}
              autoFocus
            />
            <TextField
              label="Username (optional)"
              fullWidth
              value={adminUsername}
              onChange={(e) => setAdminUsername(e.target.value)}
              sx={{ mb: 2 }}
              helperText="A display name for your profile"
            />
            <TextField
              label="Password"
              type={showPassword ? 'text' : 'password'}
              fullWidth
              required
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              sx={{ mb: 1 }}
              slotProps={{
                input: {
                  endAdornment: (
                    <IconButton onClick={() => setShowPassword(!showPassword)} edge="end" size="small">
                      {showPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                    </IconButton>
                  ),
                },
              }}
              helperText="Minimum 10 characters"
            />
            <PasswordStrengthMeter password={adminPassword} />
            <TextField
              label="Confirm Password"
              type="password"
              fullWidth
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              sx={{ mt: 2 }}
              error={confirmPassword.length > 0 && adminPassword !== confirmPassword}
              helperText={confirmPassword.length > 0 && adminPassword !== confirmPassword ? 'Passwords do not match' : ''}
            />
          </Box>
        )}

        {/* Step 3: Organization */}
        {activeStep === 3 && (
          <Box>
            <Typography variant="h6" gutterBottom>Create Your Organization</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              An organization groups your users, teams, connections, and security policies together.
              You can use your company name or any name that makes sense for your environment.
            </Typography>
            <TextField
              label="Organization Name"
              fullWidth
              required
              value={tenantName}
              onChange={(e) => setTenantName(e.target.value)}
              autoFocus
              helperText="For example: Acme Corp, IT Department, Home Lab"
            />
          </Box>
        )}

        {/* Step 3: Platform Settings */}
        {activeStep === 4 && (
          <Box>
            <Typography variant="h6" gutterBottom>Platform Settings</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Configure how your platform handles new users and notifications.
              You can change all of these later in Settings.
            </Typography>

            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={selfSignupEnabled}
                    onChange={(e) => setSelfSignupEnabled(e.target.checked)}
                  />
                }
                label="Allow self-registration"
              />
              <Typography variant="body2" color="text.secondary" sx={{ ml: 6 }}>
                {selfSignupEnabled
                  ? 'Anyone can create an account on the login page. You can assign them to your organization later.'
                  : 'Only you (the admin) can create accounts. This is recommended for most deployments.'}
              </Typography>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={configureSmtp}
                    onChange={(e) => setConfigureSmtp(e.target.checked)}
                  />
                }
                label="Configure email notifications"
              />
              <Typography variant="body2" color="text.secondary" sx={{ ml: 6, mb: configureSmtp ? 2 : 0 }}>
                {configureSmtp
                  ? 'Enter your SMTP server details to enable email verification and notifications.'
                  : 'Skip for now — you can configure this later in Settings > Administration.'}
              </Typography>

              <Collapse in={configureSmtp}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                  <TextField
                    label="SMTP Host"
                    fullWidth
                    value={smtpHost}
                    onChange={(e) => setSmtpHost(e.target.value)}
                    placeholder="smtp.example.com"
                  />
                  <Box sx={{ display: 'flex', gap: 2 }}>
                    <TextField
                      label="Port"
                      type="number"
                      value={smtpPort}
                      onChange={(e) => setSmtpPort(e.target.value)}
                      sx={{ width: 120 }}
                    />
                    <FormControlLabel
                      control={<Switch checked={smtpSecure} onChange={(e) => setSmtpSecure(e.target.checked)} />}
                      label="Use TLS"
                    />
                  </Box>
                  <TextField
                    label="Username"
                    fullWidth
                    value={smtpUser}
                    onChange={(e) => setSmtpUser(e.target.value)}
                  />
                  <TextField
                    label="Password"
                    type="password"
                    fullWidth
                    value={smtpPass}
                    onChange={(e) => setSmtpPass(e.target.value)}
                  />
                  <TextField
                    label="From Address"
                    type="email"
                    fullWidth
                    value={smtpFrom}
                    onChange={(e) => setSmtpFrom(e.target.value)}
                    placeholder="noreply@example.com"
                  />
                </Box>
              </Collapse>
            </Paper>
          </Box>
        )}

        {/* Step 5: Complete / Recovery Key */}
        {activeStep === 5 && (
          <Box>
            <Typography variant="h6" gutterBottom>Setup Complete</Typography>
            <Alert severity="success" sx={{ mb: 2 }}>
              Your Arsenale platform is ready! Here's what was created:
            </Alert>
            <Typography component="ul" variant="body2" sx={{ pl: 2, mb: 3, '& li': { mb: 0.5 } }}>
              <li>Administrator account: <strong>{adminEmail}</strong></li>
              <li>Organization: <strong>{tenantName}</strong></li>
              <li>Self-registration: <strong>{selfSignupEnabled ? 'enabled' : 'disabled'}</strong></li>
              {configureSmtp && smtpHost && <li>Email: <strong>{smtpHost}:{smtpPort}</strong></li>}
            </Typography>

            <Alert severity="warning" sx={{ mb: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                Save Your Recovery Key
              </Typography>
              <Typography variant="body2">
                This key is the only way to recover your encrypted vault if you forget your password.
                It will <strong>not</strong> be shown again.
              </Typography>
            </Alert>

            <Paper
              variant="outlined"
              sx={{
                p: 2, mb: 2,
                bgcolor: 'action.hover',
                fontFamily: 'monospace',
                fontSize: '0.85rem',
                wordBreak: 'break-all',
                position: 'relative',
              }}
            >
              {recoveryKey}
              <Box sx={{ position: 'absolute', top: 4, right: 4, display: 'flex', gap: 0.5 }}>
                <Tooltip title={copied ? 'Copied!' : 'Copy'}>
                  <IconButton size="small" onClick={handleCopyRecoveryKey}>
                    <CopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Download as file">
                  <IconButton size="small" onClick={handleDownloadRecoveryKey}>
                    <DownloadIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            </Paper>

            {systemSecrets.length > 0 && (
              <Box sx={{ mt: 3 }}>
                <Typography variant="h6" gutterBottom>
                  System Secrets
                </Typography>
                <Alert severity="info" sx={{ mb: 2 }}>
                  These secrets are auto-generated and stored encrypted in your database.
                  They are managed automatically with periodic rotation.
                  Save a backup copy now — they will not be shown again.
                </Alert>
                {systemSecrets.map((secret) => (
                  <Box key={secret.name} sx={{ mb: 2 }}>
                    <Typography variant="subtitle2" color="text.secondary">
                      {secret.name}
                    </Typography>
                    <Typography variant="caption" display="block" sx={{ mb: 0.5 }}>
                      {secret.description}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <TextField
                        fullWidth
                        size="small"
                        value={secret.value}
                        slotProps={{ input: { readOnly: true, sx: { fontFamily: 'monospace', fontSize: '0.75rem' } } }}
                      />
                      <Tooltip title="Copy to clipboard">
                        <IconButton
                          size="small"
                          onClick={() => navigator.clipboard.writeText(secret.value)}
                        >
                          <CopyIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </Box>
                ))}
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<DownloadIcon />}
                  onClick={() => {
                    const content = systemSecrets.map(s => `${s.name}=${s.value}`).join('\n');
                    const blob = new Blob([content], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'arsenale-system-secrets.env';
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Download Secrets
                </Button>
              </Box>
            )}
          </Box>
        )}

        {/* Navigation buttons */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3 }}>
          {activeStep > 0 && activeStep < 5 ? (
            <Button onClick={handleBack} disabled={loading}>
              Back
            </Button>
          ) : (
            <Box />
          )}

          {activeStep < 5 ? (
            <Button
              variant="contained"
              onClick={handleNext}
              disabled={!canProceed() || loading}
              startIcon={loading ? <CircularProgress size={16} /> : undefined}
            >
              {activeStep === 4 ? 'Complete Setup' : 'Next'}
            </Button>
          ) : (
            <Button variant="contained" onClick={handleGetStarted}>
              Get Started
            </Button>
          )}
        </Box>
      </Paper>
    </Box>
  );
}
