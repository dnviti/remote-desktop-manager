import { useCallback } from 'react';
import { Snackbar, Button, IconButton, Typography, Box } from '@mui/material';
import { Close as CloseIcon, SystemUpdateAlt as UpdateIcon } from '@mui/icons-material';
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Detects service worker updates and prompts the user to reload for the
 * latest version. Critical for a security-sensitive app to avoid running
 * stale cached code.
 *
 * Uses vite-plugin-pwa's `useRegisterSW` hook with `registerType: 'prompt'`
 * so the new service worker waits until the user explicitly accepts the update.
 */
export default function PwaUpdateNotification() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      // Check for updates every 60 minutes
      if (registration) {
        setInterval(() => {
          void registration.update();
        }, 60 * 60 * 1000);
      }
    },
  });

  const handleUpdate = useCallback(() => {
    void updateServiceWorker(true);
  }, [updateServiceWorker]);

  const handleDismiss = useCallback(() => {
    setNeedRefresh(false);
  }, [setNeedRefresh]);

  return (
    <Snackbar
      open={needRefresh}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      message={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <UpdateIcon fontSize="small" sx={{ color: 'primary.main' }} />
          <Typography variant="body2">
            A new version of Arsenale is available.
          </Typography>
        </Box>
      }
      action={
        <>
          <Button
            size="small"
            variant="contained"
            onClick={handleUpdate}
            sx={{ mr: 1 }}
          >
            Reload
          </Button>
          <IconButton
            size="small"
            color="inherit"
            onClick={handleDismiss}
            aria-label="dismiss update notification"
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </>
      }
      sx={{
        '& .MuiSnackbarContent-root': {
          bgcolor: 'background.paper',
          color: 'text.primary',
          border: 1,
          borderColor: 'divider',
          borderRadius: 2,
          boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
        },
      }}
    />
  );
}
