import { useState, useEffect } from 'react';
import {
  Card, CardContent, Typography, Button, Alert, Stack,
} from '@mui/material';
import { useTerminalSettingsStore } from '../../store/terminalSettingsStore';
import type { SshTerminalConfig } from '../../constants/terminalThemes';
import TerminalSettingsSection from './TerminalSettingsSection';
import { useRdpSettingsStore } from '../../store/rdpSettingsStore';
import type { RdpSettings } from '../../constants/rdpDefaults';
import RdpSettingsSection from './RdpSettingsSection';

export default function ConnectionDefaultsSection() {
  const { updateDefaults, loading: sshLoading } = useTerminalSettingsStore();
  const [sshConfig, setSshConfig] = useState<Partial<SshTerminalConfig>>({});
  const [sshError, setSshError] = useState('');
  const [sshSuccess, setSshSuccess] = useState('');

  const { updateDefaults: updateRdpDefaults, loading: rdpLoading } = useRdpSettingsStore();
  const [rdpConfig, setRdpConfig] = useState<Partial<RdpSettings>>({});
  const [rdpError, setRdpError] = useState('');
  const [rdpSuccess, setRdpSuccess] = useState('');

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

  return (
    <Stack spacing={3}>
      <Card>
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

      <Card>
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
    </Stack>
  );
}
