import {
  Card, CardContent, Typography, Switch, FormControlLabel, Alert, Box,
} from '@mui/material';
import { useDesktopNotifications } from '../../hooks/useDesktopNotifications';

export default function NotificationsSection() {
  const { supported, permission, enabled, setEnabled } = useDesktopNotifications();

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
          Desktop Notifications
        </Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Receive native desktop notifications when new alerts arrive while the app is not in focus.
        </Typography>

        {!supported ? (
          <Alert severity="warning" sx={{ mt: 2 }}>
            Your browser does not support desktop notifications.
          </Alert>
        ) : (
          <Box sx={{ mt: 2 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={enabled}
                  onChange={(_, checked) => setEnabled(checked)}
                  disabled={permission === 'denied'}
                />
              }
              label="Enable desktop notifications"
            />

            {permission === 'denied' && (
              <Alert severity="info" sx={{ mt: 1 }}>
                Notification permission was denied by the browser. To re-enable, open your
                browser&apos;s site settings for this page and allow notifications.
              </Alert>
            )}

            {permission === 'default' && enabled && (
              <Alert severity="info" sx={{ mt: 1 }}>
                You will be prompted to grant notification permission when the next notification arrives.
              </Alert>
            )}

            {permission === 'granted' && enabled && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Desktop notifications are active. Notifications will appear when the app is not in focus.
              </Typography>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
