import { useState, useEffect } from 'react';
import {
  Box, Typography, Button, Accordion, AccordionSummary, AccordionDetails,
  Switch, FormControlLabel, Stack, Alert,
} from '@mui/material';
import { ExpandMore as ExpandMoreIcon } from '@mui/icons-material';
import { useTenantStore } from '../../store/tenantStore';
import type { EnforcedConnectionSettings } from '../../api/tenant.api';
import type { SshTerminalConfig } from '../../constants/terminalThemes';
import type { RdpSettings } from '../../constants/rdpDefaults';
import { RDP_DEFAULTS } from '../../constants/rdpDefaults';
import type { VncSettings } from '../../constants/vncDefaults';
import { VNC_DEFAULTS } from '../../constants/vncDefaults';
import { TERMINAL_DEFAULTS } from '../../constants/terminalThemes';
import TerminalSettingsSection from './TerminalSettingsSection';
import RdpSettingsSection from './RdpSettingsSection';
import VncSettingsSection from './VncSettingsSection';
import { useAsyncAction } from '../../hooks/useAsyncAction';

export default function TenantConnectionPolicySection() {
  const tenant = useTenantStore((s) => s.tenant);
  const updateTenant = useTenantStore((s) => s.updateTenant);
  const { loading, error, clearError, run } = useAsyncAction();
  const [success, setSuccess] = useState(false);

  const [sshEnabled, setSshEnabled] = useState(false);
  const [rdpEnabled, setRdpEnabled] = useState(false);
  const [vncEnabled, setVncEnabled] = useState(false);
  const [sshSettings, setSshSettings] = useState<Partial<SshTerminalConfig>>({});
  const [rdpSettings, setRdpSettings] = useState<Partial<RdpSettings>>({});
  const [vncSettings, setVncSettings] = useState<Partial<VncSettings>>({});

  /* eslint-disable react-hooks/set-state-in-effect -- resetting form state when tenant data loads is intentional */
  useEffect(() => {
    const enforced = tenant?.enforcedConnectionSettings as EnforcedConnectionSettings | null | undefined;
    if (enforced) {
      if (enforced.ssh && Object.keys(enforced.ssh).length > 0) {
        setSshEnabled(true);
        setSshSettings(enforced.ssh);
      } else {
        setSshEnabled(false);
        setSshSettings({});
      }
      if (enforced.rdp && Object.keys(enforced.rdp).length > 0) {
        setRdpEnabled(true);
        setRdpSettings(enforced.rdp);
      } else {
        setRdpEnabled(false);
        setRdpSettings({});
      }
      if (enforced.vnc && Object.keys(enforced.vnc).length > 0) {
        setVncEnabled(true);
        setVncSettings(enforced.vnc);
      } else {
        setVncEnabled(false);
        setVncSettings({});
      }
    } else {
      setSshEnabled(false);
      setRdpEnabled(false);
      setVncEnabled(false);
      setSshSettings({});
      setRdpSettings({});
      setVncSettings({});
    }
  }, [tenant?.enforcedConnectionSettings]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleSave = async () => {
    setSuccess(false);
    clearError();
    const payload: EnforcedConnectionSettings = {};
    if (sshEnabled && Object.keys(sshSettings).length > 0) payload.ssh = sshSettings;
    if (rdpEnabled && Object.keys(rdpSettings).length > 0) payload.rdp = rdpSettings;
    if (vncEnabled && Object.keys(vncSettings).length > 0) payload.vnc = vncSettings;

    const hasAny = Object.keys(payload).length > 0;
    const ok = await run(
      () => updateTenant({ enforcedConnectionSettings: hasAny ? payload : null }),
      'Failed to save connection policy',
    );
    if (ok) setSuccess(true);
  };

  const handleClear = async () => {
    setSuccess(false);
    clearError();
    const ok = await run(
      () => updateTenant({ enforcedConnectionSettings: null }),
      'Failed to clear connection policy',
    );
    if (ok) {
      setSshEnabled(false);
      setRdpEnabled(false);
      setVncEnabled(false);
      setSshSettings({});
      setRdpSettings({});
      setVncSettings({});
      setSuccess(true);
    }
  };

  if (!tenant) return null;

  return (
    <Box>
      <Typography variant="h6" gutterBottom>Connection Policy Enforcement</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Settings configured here are enforced on all connections in the organization.
        Users cannot override enforced settings in their connection or personal defaults.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }}>Connection policy saved.</Alert>}

      <Stack spacing={1}>
        <Accordion variant="outlined" disableGutters>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <FormControlLabel
              control={<Switch checked={sshEnabled} onChange={(e) => { setSshEnabled(e.target.checked); if (!e.target.checked) setSshSettings({}); }} onClick={(e) => e.stopPropagation()} />}
              label={<Typography variant="subtitle2">SSH Terminal Settings</Typography>}
              sx={{ mr: 0 }}
            />
          </AccordionSummary>
          <AccordionDetails>
            {sshEnabled ? (
              <TerminalSettingsSection
                value={sshSettings}
                onChange={setSshSettings}
                mode="global"
                resolvedDefaults={TERMINAL_DEFAULTS}
              />
            ) : (
              <Typography variant="body2" color="text.secondary">
                Enable to enforce SSH terminal settings across all connections.
              </Typography>
            )}
          </AccordionDetails>
        </Accordion>

        <Accordion variant="outlined" disableGutters>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <FormControlLabel
              control={<Switch checked={rdpEnabled} onChange={(e) => { setRdpEnabled(e.target.checked); if (!e.target.checked) setRdpSettings({}); }} onClick={(e) => e.stopPropagation()} />}
              label={<Typography variant="subtitle2">RDP Settings</Typography>}
              sx={{ mr: 0 }}
            />
          </AccordionSummary>
          <AccordionDetails>
            {rdpEnabled ? (
              <RdpSettingsSection
                value={rdpSettings}
                onChange={setRdpSettings}
                mode="global"
                resolvedDefaults={RDP_DEFAULTS}
              />
            ) : (
              <Typography variant="body2" color="text.secondary">
                Enable to enforce RDP settings across all connections.
              </Typography>
            )}
          </AccordionDetails>
        </Accordion>

        <Accordion variant="outlined" disableGutters>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <FormControlLabel
              control={<Switch checked={vncEnabled} onChange={(e) => { setVncEnabled(e.target.checked); if (!e.target.checked) setVncSettings({}); }} onClick={(e) => e.stopPropagation()} />}
              label={<Typography variant="subtitle2">VNC Settings</Typography>}
              sx={{ mr: 0 }}
            />
          </AccordionSummary>
          <AccordionDetails>
            {vncEnabled ? (
              <VncSettingsSection
                value={vncSettings}
                onChange={setVncSettings}
                mode="global"
                resolvedDefaults={VNC_DEFAULTS}
              />
            ) : (
              <Typography variant="body2" color="text.secondary">
                Enable to enforce VNC settings across all connections.
              </Typography>
            )}
          </AccordionDetails>
        </Accordion>
      </Stack>

      <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
        <Button variant="contained" onClick={handleSave} disabled={loading}>
          {loading ? 'Saving...' : 'Save Policy'}
        </Button>
        <Button variant="outlined" onClick={handleClear} disabled={loading}>
          Clear All
        </Button>
      </Box>
    </Box>
  );
}
