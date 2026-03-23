import { Box, Button, Chip, CircularProgress, Typography } from '@mui/material';
import { ErrorOutline as ErrorIcon, SignalWifiOff as UnstableIcon } from '@mui/icons-material';

interface ReconnectOverlayProps {
  state: 'reconnecting' | 'unstable' | 'failed';
  attempt: number;
  maxRetries: number;
  onRetry?: () => void;
  onClose?: () => void;
  protocol: 'RDP' | 'VNC' | 'SSH' | 'DATABASE';
}

export default function ReconnectOverlay({ state, attempt, maxRetries, onRetry, onClose, protocol }: ReconnectOverlayProps) {
  if (state === 'unstable') {
    return (
      <Box sx={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 2 }}>
        <Chip
          icon={<UnstableIcon fontSize="small" />}
          label="Connection unstable"
          color="warning"
          size="small"
          variant="filled"
        />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1,
        bgcolor: 'rgba(0,0,0,0.7)',
        gap: 2,
      }}
    >
      {state === 'reconnecting' && (
        <>
          <CircularProgress size={32} />
          <Typography>
            Reconnecting to {protocol} session... (attempt {attempt + 1}/{maxRetries})
          </Typography>
        </>
      )}
      {state === 'failed' && (
        <>
          <ErrorIcon sx={{ fontSize: 48, color: 'error.main' }} />
          <Typography variant="h6">Reconnection failed</Typography>
          <Typography variant="body2" color="text.secondary">
            Could not restore the {protocol} session after {maxRetries} attempts.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
            {onRetry && (
              <Button variant="contained" size="small" onClick={onRetry}>
                Retry
              </Button>
            )}
            {onClose && (
              <Button variant="outlined" size="small" onClick={onClose}>
                Close Tab
              </Button>
            )}
          </Box>
        </>
      )}
    </Box>
  );
}
