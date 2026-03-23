import { Box, Chip, Typography } from '@mui/material';
import {
  CheckCircle as ConnectedIcon,
  Cancel as DisconnectedIcon,
  HourglassEmpty as ConnectingIcon,
  Tune as ConfiguredIcon,
} from '@mui/icons-material';

export type DbConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

interface DbConnectionStatusProps {
  state: DbConnectionState;
  protocol: string;
  databaseName?: string;
  error?: string;
  hasSessionConfig?: boolean;
}

export default function DbConnectionStatus({
  state,
  protocol,
  databaseName,
  error,
  hasSessionConfig,
}: DbConnectionStatusProps) {
  const statusConfig: Record<
    DbConnectionState,
    { label: string; color: 'default' | 'success' | 'error' | 'warning'; icon: React.ReactElement }
  > = {
    connecting: {
      label: 'Connecting',
      color: 'warning',
      icon: <ConnectingIcon sx={{ fontSize: 14 }} />,
    },
    connected: {
      label: 'Connected',
      color: 'success',
      icon: <ConnectedIcon sx={{ fontSize: 14 }} />,
    },
    disconnected: {
      label: 'Disconnected',
      color: 'default',
      icon: <DisconnectedIcon sx={{ fontSize: 14 }} />,
    },
    error: {
      label: 'Error',
      color: 'error',
      icon: <DisconnectedIcon sx={{ fontSize: 14 }} />,
    },
  };

  const { label, color, icon } = statusConfig[state];

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Chip
        icon={icon}
        label={label}
        color={color}
        size="small"
        variant="outlined"
        sx={{ height: 24 }}
      />
      <Typography variant="caption" color="text.secondary">
        {protocol.toUpperCase()}
      </Typography>
      {databaseName && (
        <Typography variant="caption" color="text.secondary">
          / {databaseName}
        </Typography>
      )}
      {hasSessionConfig && (
        <ConfiguredIcon sx={{ fontSize: 12, color: 'primary.main', ml: 0.5 }} />
      )}
      {state === 'error' && error && (
        <Typography variant="caption" color="error.main" sx={{ ml: 1 }}>
          {error}
        </Typography>
      )}
    </Box>
  );
}
