import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AppBar, Toolbar, Typography, Box, Card, CardContent, TextField, Button,
  Alert, Avatar, IconButton, Stack,
} from '@mui/material';
import { ArrowBack as ArrowBackIcon } from '@mui/icons-material';
import { useAuthStore } from '../store/authStore';
import { getProfile, updateProfile, changePassword, uploadAvatar } from '../api/user.api';
import { useTerminalSettingsStore } from '../store/terminalSettingsStore';
import type { SshTerminalConfig } from '../constants/terminalThemes';
import TerminalSettingsSection from '../components/Settings/TerminalSettingsSection';
import { useRdpSettingsStore } from '../store/rdpSettingsStore';
import type { RdpSettings } from '../constants/rdpDefaults';
import RdpSettingsSection from '../components/Settings/RdpSettingsSection';
import TwoFactorSection from '../components/Settings/TwoFactorSection';
import LinkedAccountsSection from '../components/Settings/LinkedAccountsSection';

export default function SettingsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const updateUser = useAuthStore((s) => s.updateUser);
  const authLogout = useAuthStore((s) => s.logout);
  const [hasPassword, setHasPassword] = useState(true);

  // Profile form
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Password form
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  // SSH Terminal defaults
  const { userDefaults, fetchDefaults, updateDefaults, loading: sshLoading } = useTerminalSettingsStore();
  const [sshConfig, setSshConfig] = useState<Partial<SshTerminalConfig>>({});
  const [sshError, setSshError] = useState('');
  const [sshSuccess, setSshSuccess] = useState('');

  // RDP defaults
  const { userDefaults: rdpUserDefaults, fetchDefaults: fetchRdpDefaults, updateDefaults: updateRdpDefaults, loading: rdpLoading } = useRdpSettingsStore();
  const [rdpConfig, setRdpConfig] = useState<Partial<RdpSettings>>({});
  const [rdpError, setRdpError] = useState('');
  const [rdpSuccess, setRdpSuccess] = useState('');

  useEffect(() => {
    getProfile().then((profile) => {
      setUsername(profile.username ?? '');
      setEmail(profile.email);
      setAvatarPreview(profile.avatarData);
      setHasPassword(profile.hasPassword);
    }).catch(() => {
      setProfileError('Failed to load profile');
    });
    fetchDefaults();
    fetchRdpDefaults();

    const linked = searchParams.get('linked');
    if (linked) {
      setProfileSuccess(`${linked.charAt(0).toUpperCase() + linked.slice(1)} account linked successfully`);
      searchParams.delete('linked');
      setSearchParams(searchParams, { replace: true });
    }
  }, []);

  useEffect(() => {
    if (userDefaults) setSshConfig(userDefaults);
  }, [userDefaults]);

  useEffect(() => {
    if (rdpUserDefaults) setRdpConfig(rdpUserDefaults);
  }, [rdpUserDefaults]);

  const handleSaveSshDefaults = async () => {
    setSshError('');
    setSshSuccess('');
    try {
      await updateDefaults(sshConfig);
      setSshSuccess('SSH terminal defaults saved');
    } catch {
      setSshError('Failed to save SSH defaults');
    }
  };

  const handleSaveRdpDefaults = async () => {
    setRdpError('');
    setRdpSuccess('');
    try {
      await updateRdpDefaults(rdpConfig);
      setRdpSuccess('RDP defaults saved');
    } catch {
      setRdpError('Failed to save RDP defaults');
    }
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 200 * 1024) {
      setProfileError('Avatar must be under 200KB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setAvatarPreview(dataUrl);
      setProfileError('');
      uploadAvatar(dataUrl).then((result) => {
        updateUser({ avatarData: result.avatarData });
        setProfileSuccess('Avatar updated');
      }).catch(() => {
        setProfileError('Failed to upload avatar');
      });
    };
    reader.readAsDataURL(file);
  };

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError('');
    setProfileSuccess('');
    setProfileLoading(true);
    try {
      const result = await updateProfile({
        username: username || undefined,
        email,
      });
      updateUser({ email: result.email, username: result.username });
      setProfileSuccess('Profile updated successfully');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to update profile';
      setProfileError(msg);
    } finally {
      setProfileLoading(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }

    setPasswordLoading(true);
    try {
      await changePassword(oldPassword, newPassword);
      setPasswordSuccess('Password changed. You will be signed out...');
      setTimeout(() => {
        authLogout();
        navigate('/login');
      }, 2000);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to change password';
      setPasswordError(msg);
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <AppBar position="static">
        <Toolbar variant="dense">
          <IconButton color="inherit" onClick={() => navigate('/')} sx={{ mr: 1 }}>
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6">Settings</Typography>
        </Toolbar>
      </AppBar>

      <Box sx={{ flex: 1, overflow: 'auto', p: 3, maxWidth: 700, mx: 'auto', width: '100%' }}>
        {/* Profile Section */}
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>Profile</Typography>
            <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
              <Avatar
                src={avatarPreview ?? undefined}
                sx={{ width: 64, height: 64, cursor: 'pointer' }}
                onClick={() => fileInputRef.current?.click()}
              />
              <Button variant="outlined" size="small" onClick={() => fileInputRef.current?.click()}>
                Change Avatar
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={handleAvatarChange}
              />
            </Stack>

            {profileError && <Alert severity="error" sx={{ mb: 2 }}>{profileError}</Alert>}
            {profileSuccess && <Alert severity="success" sx={{ mb: 2 }}>{profileSuccess}</Alert>}

            <Box component="form" onSubmit={handleProfileSave}>
              <TextField
                fullWidth label="Username" value={username}
                onChange={(e) => setUsername(e.target.value)}
                margin="normal"
                placeholder="Optional display name"
              />
              <TextField
                fullWidth label="Email" type="email" value={email}
                onChange={(e) => setEmail(e.target.value)}
                margin="normal" required
              />
              <Button
                type="submit" variant="contained" disabled={profileLoading}
                sx={{ mt: 2 }}
              >
                {profileLoading ? 'Saving...' : 'Save Profile'}
              </Button>
            </Box>
          </CardContent>
        </Card>

        {/* SSH Terminal Defaults Section */}
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>SSH Terminal Defaults</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              These settings apply to all SSH sessions unless overridden per connection.
            </Typography>

            {sshError && <Alert severity="error" sx={{ mb: 2 }}>{sshError}</Alert>}
            {sshSuccess && <Alert severity="success" sx={{ mb: 2 }}>{sshSuccess}</Alert>}

            <TerminalSettingsSection value={sshConfig} onChange={setSshConfig} mode="global" />
            <Button
              variant="contained"
              disabled={sshLoading}
              onClick={handleSaveSshDefaults}
              sx={{ mt: 2 }}
            >
              {sshLoading ? 'Saving...' : 'Save SSH Defaults'}
            </Button>
          </CardContent>
        </Card>

        {/* RDP Defaults Section */}
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>RDP Defaults</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              These settings apply to all RDP sessions unless overridden per connection.
            </Typography>

            {rdpError && <Alert severity="error" sx={{ mb: 2 }}>{rdpError}</Alert>}
            {rdpSuccess && <Alert severity="success" sx={{ mb: 2 }}>{rdpSuccess}</Alert>}

            <RdpSettingsSection value={rdpConfig} onChange={setRdpConfig} mode="global" />
            <Button
              variant="contained"
              disabled={rdpLoading}
              onClick={handleSaveRdpDefaults}
              sx={{ mt: 2 }}
            >
              {rdpLoading ? 'Saving...' : 'Save RDP Defaults'}
            </Button>
          </CardContent>
        </Card>

        {/* Two-Factor Authentication */}
        <Box sx={{ mb: 3 }}>
          <TwoFactorSection />
        </Box>

        {/* Linked Accounts */}
        <Box sx={{ mb: 3 }}>
          <LinkedAccountsSection hasPassword={hasPassword} />
        </Box>

        {/* Change Password */}
        {hasPassword && (<Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>Change Password</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Changing your password will lock your vault and sign you out of all devices.
            </Typography>

            {passwordError && <Alert severity="error" sx={{ mb: 2 }}>{passwordError}</Alert>}
            {passwordSuccess && <Alert severity="success" sx={{ mb: 2 }}>{passwordSuccess}</Alert>}

            <Box component="form" onSubmit={handlePasswordChange}>
              <TextField
                fullWidth label="Current Password" type="password"
                value={oldPassword} onChange={(e) => setOldPassword(e.target.value)}
                margin="normal" required
              />
              <TextField
                fullWidth label="New Password" type="password"
                value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                margin="normal" required
                helperText="Minimum 8 characters"
              />
              <TextField
                fullWidth label="Confirm New Password" type="password"
                value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                margin="normal" required
              />
              <Button
                type="submit" variant="contained" color="warning"
                disabled={passwordLoading}
                sx={{ mt: 2 }}
              >
                {passwordLoading ? 'Changing...' : 'Change Password'}
              </Button>
            </Box>
          </CardContent>
        </Card>)}
      </Box>
    </Box>
  );
}
