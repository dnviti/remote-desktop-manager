import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card, CardContent, Typography, Box, Switch, FormControlLabel,
  CircularProgress, Alert, Table, TableBody, TableCell, TableHead,
  TableRow, Tooltip, TextField, Autocomplete, Divider,
} from '@mui/material';
import {
  Notifications as NotificationsIcon,
  Email as EmailIcon,
  DoNotDisturb as DoNotDisturbIcon,
} from '@mui/icons-material';
import {
  getPreferences,
  updatePreference,
  getNotificationSchedule,
  updateNotificationSchedule,
  type NotificationType,
  type NotificationPreference,
  type NotificationSchedule,
} from '../../api/notifications.api';
import { extractApiError } from '../../utils/apiError';

interface NotificationCategory {
  label: string;
  types: NotificationType[];
}

const CATEGORIES: NotificationCategory[] = [
  {
    label: 'Sharing',
    types: ['CONNECTION_SHARED', 'SHARE_PERMISSION_UPDATED', 'SHARE_REVOKED'],
  },
  {
    label: 'Secrets',
    types: ['SECRET_SHARED', 'SECRET_SHARE_REVOKED', 'SECRET_EXPIRING', 'SECRET_EXPIRED'],
  },
  {
    label: 'Security',
    types: ['IMPOSSIBLE_TRAVEL_DETECTED'],
  },
  {
    label: 'Organization',
    types: ['TENANT_INVITATION'],
  },
  {
    label: 'Sessions',
    types: ['RECORDING_READY'],
  },
];

const TYPE_LABELS: Record<NotificationType, string> = {
  CONNECTION_SHARED: 'Connection Shared With You',
  SHARE_PERMISSION_UPDATED: 'Share Permission Updated',
  SHARE_REVOKED: 'Share Revoked',
  SECRET_SHARED: 'Secret Shared With You',
  SECRET_SHARE_REVOKED: 'Secret Share Revoked',
  SECRET_EXPIRING: 'Secret Expiring Soon',
  SECRET_EXPIRED: 'Secret Expired',
  IMPOSSIBLE_TRAVEL_DETECTED: 'Impossible Travel Detected',
  TENANT_INVITATION: 'Organization Invitation',
  RECORDING_READY: 'Session Recording Ready',
};

/** Build a sorted list of common IANA timezone names via Intl API. */
function getTimezoneOptions(): string[] {
  try {
    // Intl.supportedValuesOf is available in modern browsers
    return (Intl as unknown as { supportedValuesOf(key: string): string[] })
      .supportedValuesOf('timeZone');
  } catch {
    // Fallback: a curated short list
    return [
      'UTC',
      'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
      'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
      'Europe/Rome', 'Europe/Moscow', 'Asia/Dubai', 'Asia/Kolkata',
      'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland',
    ];
  }
}

const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export default function NotificationPreferencesSection() {
  const [prefs, setPrefs] = useState<Map<NotificationType, NotificationPreference>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<Set<NotificationType>>(new Set());

  // Quiet Hours / DND state
  const [schedule, setSchedule] = useState<NotificationSchedule>({
    dndEnabled: false,
    quietHoursStart: null,
    quietHoursEnd: null,
    quietHoursTimezone: null,
  });
  const [scheduleSaving, setScheduleSaving] = useState(false);

  const timezoneOptions = useMemo(() => getTimezoneOptions(), []);

  useEffect(() => {
    Promise.all([
      getPreferences(),
      getNotificationSchedule(),
    ])
      .then(([list, sched]) => {
        const map = new Map(list.map((p) => [p.type, p]));
        setPrefs(map);
        setSchedule(sched);
      })
      .catch((err) => setError(extractApiError(err, 'Failed to load preferences')))
      .finally(() => setLoading(false));
  }, []);

  const handleToggle = useCallback(
    async (type: NotificationType, channel: 'inApp' | 'email', value: boolean) => {
      // Optimistic update
      setPrefs((prev) => {
        const next = new Map(prev);
        const current = next.get(type);
        if (current) next.set(type, { ...current, [channel]: value });
        return next;
      });
      setSaving((prev) => new Set([...prev, type]));

      try {
        const updated = await updatePreference(type, { [channel]: value });
        setPrefs((prev) => {
          const next = new Map(prev);
          next.set(type, updated);
          return next;
        });
      } catch (err) {
        // Revert on error
        setPrefs((prev) => {
          const next = new Map(prev);
          const current = next.get(type);
          if (current) next.set(type, { ...current, [channel]: !value });
          return next;
        });
        setError(extractApiError(err, 'Failed to update preference'));
      } finally {
        setSaving((prev) => {
          const next = new Set(prev);
          next.delete(type);
          return next;
        });
      }
    },
    []
  );

  const handleScheduleChange = useCallback(
    async (update: Partial<NotificationSchedule>) => {
      // Optimistic update
      setSchedule((prev) => ({ ...prev, ...update }));
      setScheduleSaving(true);
      try {
        const updated = await updateNotificationSchedule(update);
        setSchedule(updated);
      } catch (err) {
        setError(extractApiError(err, 'Failed to update notification schedule'));
      } finally {
        setScheduleSaving(false);
      }
    },
    []
  );

  if (loading) {
    return (
      <Card variant="outlined">
        <CardContent sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={24} />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
          Notification Preferences
        </Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Choose which events trigger in-app or email notifications.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        {CATEGORIES.map((category) => (
          <Box key={category.label} sx={{ mb: 3 }}>
            <Typography variant="body2" fontWeight="medium" color="text.secondary" sx={{ mb: 1, textTransform: 'uppercase', letterSpacing: '0.5px', fontSize: '0.7rem' }}>
              {category.label}
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ pl: 0 }}>Event</TableCell>
                  <TableCell align="center" sx={{ width: 80 }}>
                    <Tooltip title="In-app notifications">
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                        <NotificationsIcon sx={{ fontSize: 16 }} />
                      </Box>
                    </Tooltip>
                  </TableCell>
                  <TableCell align="center" sx={{ width: 80 }}>
                    <Tooltip title="Email notifications">
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                        <EmailIcon sx={{ fontSize: 16 }} />
                      </Box>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {category.types.map((type) => {
                  const pref = prefs.get(type);
                  const isSaving = saving.has(type);
                  return (
                    <TableRow key={type} sx={{ '&:last-child td': { border: 0 } }}>
                      <TableCell sx={{ pl: 0 }}>
                        <Typography variant="body2">{TYPE_LABELS[type]}</Typography>
                      </TableCell>
                      <TableCell align="center">
                        <FormControlLabel
                          control={
                            <Switch
                              size="small"
                              checked={pref?.inApp ?? true}
                              disabled={isSaving}
                              onChange={(e) => handleToggle(type, 'inApp', e.target.checked)}
                            />
                          }
                          label=""
                          sx={{ m: 0 }}
                        />
                      </TableCell>
                      <TableCell align="center">
                        <FormControlLabel
                          control={
                            <Switch
                              size="small"
                              checked={pref?.email ?? false}
                              disabled={isSaving}
                              onChange={(e) => handleToggle(type, 'email', e.target.checked)}
                            />
                          }
                          label=""
                          sx={{ m: 0 }}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
        ))}
      </CardContent>
    </Card>

    {/* Quiet Hours / Do Not Disturb */}
    <Card variant="outlined" sx={{ mt: 2 }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <DoNotDisturbIcon fontSize="small" color="action" />
          <Typography variant="subtitle1" fontWeight="bold">
            Quiet Hours
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Suppress non-critical real-time notifications during specific hours.
          Notifications are still saved and can be read later.
          Security-critical alerts always bypass quiet hours.
        </Typography>

        <Divider sx={{ my: 2 }} />

        {/* DND toggle */}
        <FormControlLabel
          control={
            <Switch
              checked={schedule.dndEnabled}
              disabled={scheduleSaving}
              onChange={(e) => handleScheduleChange({ dndEnabled: e.target.checked })}
            />
          }
          label={
            <Box>
              <Typography variant="body2" fontWeight="medium">Do Not Disturb</Typography>
              <Typography variant="caption" color="text.secondary">
                Immediately suppress all non-critical real-time notifications
              </Typography>
            </Box>
          }
          sx={{ mb: 2, alignItems: 'flex-start', ml: 0 }}
        />

        <Divider sx={{ my: 2 }} />

        {/* Quiet hours time range */}
        <Typography variant="body2" fontWeight="medium" sx={{ mb: 1.5 }}>
          Scheduled Quiet Hours
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
          <TextField
            label="Start time"
            type="time"
            size="small"
            value={schedule.quietHoursStart ?? ''}
            disabled={scheduleSaving}
            onChange={(e) =>
              handleScheduleChange({ quietHoursStart: e.target.value || null })
            }
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ width: 150 }}
          />
          <Typography variant="body2" color="text.secondary">to</Typography>
          <TextField
            label="End time"
            type="time"
            size="small"
            value={schedule.quietHoursEnd ?? ''}
            disabled={scheduleSaving}
            onChange={(e) =>
              handleScheduleChange({ quietHoursEnd: e.target.value || null })
            }
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ width: 150 }}
          />
        </Box>

        {/* Timezone selector */}
        <Autocomplete
          size="small"
          options={timezoneOptions}
          value={schedule.quietHoursTimezone ?? browserTimezone}
          disabled={scheduleSaving}
          onChange={(_e, value) =>
            handleScheduleChange({ quietHoursTimezone: value ?? browserTimezone })
          }
          renderInput={(params) => (
            <TextField {...params} label="Timezone" />
          )}
          sx={{ maxWidth: 350 }}
        />
      </CardContent>
    </Card>
    </>
  );
}
