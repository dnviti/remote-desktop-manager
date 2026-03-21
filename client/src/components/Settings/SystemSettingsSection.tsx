import { useState, useEffect, useCallback } from 'react';
import {
  Card, CardContent, Typography, CircularProgress, Alert, Accordion,
  AccordionSummary, AccordionDetails, Box, Divider, Chip,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import TuneIcon from '@mui/icons-material/Tune';
import { getSystemSettings } from '../../api/systemSettings.api';
import type { SettingValue, SettingGroup } from '../../api/systemSettings.api';
import { extractApiError } from '../../utils/apiError';
import SettingField from './SettingField';

export default function SystemSettingsSection() {
  const [settings, setSettings] = useState<SettingValue[]>([]);
  const [groups, setGroups] = useState<SettingGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    getSystemSettings()
      .then((data) => {
        setSettings(data.settings);
        setGroups(data.groups);
        setLoading(false);
      })
      .catch((err) => {
        setError(extractApiError(err, 'Failed to load system settings'));
        setLoading(false);
      });
  }, []);

  const handleUpdated = useCallback((key: string, value: unknown) => {
    setSettings((prev) =>
      prev.map((s) =>
        s.key === key ? { ...s, value, source: 'db' as const, envLocked: false } : s,
      ),
    );
  }, []);

  if (loading) {
    return (
      <Card variant="outlined">
        <CardContent sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={24} />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Alert severity="error">{error}</Alert>
        </CardContent>
      </Card>
    );
  }

  const grouped = new Map<string, SettingValue[]>();
  for (const s of settings) {
    const arr = grouped.get(s.group) || [];
    arr.push(s);
    grouped.set(s.group, arr);
  }

  const sortedGroups = groups
    .filter((g) => grouped.has(g.key))
    .sort((a, b) => a.order - b.order);

  return (
    <Card variant="outlined">
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <TuneIcon color="primary" />
          <Typography variant="subtitle1" fontWeight="bold">
            System Settings
          </Typography>
          <Chip
            label={`${settings.length} settings`}
            size="small"
            variant="outlined"
          />
        </Box>

        <Alert severity="info" sx={{ mb: 2 }}>
          Settings locked by environment variables are read-only. Changes to settings marked
          with a restart icon take effect after the server is restarted.
        </Alert>

        {sortedGroups.map((group) => {
          const groupSettings = grouped.get(group.key) || [];
          const envCount = groupSettings.filter((s) => s.envLocked).length;

          return (
            <Accordion key={group.key} disableGutters variant="outlined" sx={{ mb: 1 }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body1" fontWeight="medium">
                    {group.label}
                  </Typography>
                  <Chip
                    label={`${groupSettings.length}`}
                    size="small"
                    variant="outlined"
                  />
                  {envCount > 0 && (
                    <Chip
                      label={`${envCount} locked`}
                      size="small"
                      color="warning"
                      variant="outlined"
                    />
                  )}
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                {groupSettings.map((s, idx) => (
                  <Box key={s.key}>
                    {idx > 0 && <Divider sx={{ my: 1 }} />}
                    <SettingField setting={s} onUpdated={handleUpdated} />
                  </Box>
                ))}
              </AccordionDetails>
            </Accordion>
          );
        })}
      </CardContent>
    </Card>
  );
}
