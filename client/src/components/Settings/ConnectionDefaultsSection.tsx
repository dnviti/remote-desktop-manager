import { useState, useEffect } from 'react';
import {
  Typography, Button, Alert, Stack,
  Card, CardContent,
} from '@mui/material';
import { useNotificationStore } from '../../store/notificationStore';
import { useTerminalSettingsStore } from '../../store/terminalSettingsStore';
import type { SshTerminalConfig } from '../../constants/terminalThemes';
import TerminalSettingsSection from './TerminalSettingsSection';
import { useRdpSettingsStore } from '../../store/rdpSettingsStore';
import type { RdpSettings } from '../../constants/rdpDefaults';
import RdpSettingsSection from './RdpSettingsSection';

export default function ConnectionDefaultsSection() {
  const notify = useNotificationStore((s) => s.notify);
  const updateDefaults = useTerminalSettingsStore((s) => s.updateDefaults);
  const sshLoading = useTerminalSettingsStore((s) => s.loading);
  const [sshConfig, setSshConfig] = useState<Partial<SshTerminalConfig>>({});
  const [sshError, setSshError] = useState('');

  const updateRdpDefaults = useRdpSettingsStore((s) => s.updateDefaults);
  const rdpLoading = useRdpSettingsStore((s) => s.loading);
  const [rdpConfig, setRdpConfig] = useState<Partial<RdpSettings>>({});
  const [rdpError, setRdpError] = useState('');

  useEffect(() => {
    useTerminalSettingsStore.getState().fetchDefaults().then(() => {
      const defaults = useTerminalSettingsStore.getState().userDefaults;
      if (defaults) setSshConfig(defaults);
    });
    useRdpSettingsStore.getState().fetchDefaults().then(() => {
      const defaults = useRdpSettingsStore.getState().userDefaults;
      if (defaults) setRdpConfig(defaults);
    });
  }, []);

  const handleSaveSshDefaults = async () => {
    setSshError('');
    try {
      await updateDefaults(sshConfig);
      notify('SSH terminal defaults saved', 'success');
    } catch {
      setSshError('Failed to save SSH defaults');
    }
  };

  const handleSaveRdpDefaults = async () => {
    setRdpError('');
    try {
      await updateRdpDefaults(rdpConfig);
      notify('RDP defaults saved', 'success');
    } catch {
      setRdpError('Failed to save RDP defaults');
    }
  };

  return (
    <Stack spacing={2}>
      <Card>
        <CardContent>
          <Typography variant="subtitle1" fontWeight="bold" gutterBottom>SSH Terminal Defaults</Typography>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              These settings apply to all SSH sessions unless overridden per connection.
            </Typography>

            {sshError && <Alert severity="error">{sshError}</Alert>}

            <TerminalSettingsSection value={sshConfig} onChange={setSshConfig} mode="global" />
            <Button
              variant="contained"
              disabled={sshLoading}
              onClick={handleSaveSshDefaults}
              size="small"
            >
              {sshLoading ? 'Saving...' : 'Save SSH Defaults'}
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="subtitle1" fontWeight="bold" gutterBottom>RDP Defaults</Typography>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              These settings apply to all RDP sessions unless overridden per connection.
            </Typography>

            {rdpError && <Alert severity="error">{rdpError}</Alert>}

            <RdpSettingsSection value={rdpConfig} onChange={setRdpConfig} mode="global" />
            <Button
              variant="contained"
              disabled={rdpLoading}
              onClick={handleSaveRdpDefaults}
              size="small"
            >
              {rdpLoading ? 'Saving...' : 'Save RDP Defaults'}
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
