import { useState, useCallback, useEffect } from 'react';
import {
  Popover,
  Box,
  Typography,
  TextField,
  Button,
  Alert,
  CircularProgress,
  Divider,
  Tooltip,
} from '@mui/material';
import type { DbSessionConfig } from '../../api/database.api';
import { updateDbSessionConfig } from '../../api/database.api';
import { extractApiError } from '../../utils/apiError';

interface DbSessionConfigPopoverProps {
  open: boolean;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  protocol: string;
  sessionId: string | null;
  currentConfig: DbSessionConfig;
  onConfigApplied: (config: DbSessionConfig, activeDatabase?: string) => void;
}

// Per-protocol field visibility
const FIELD_SUPPORT: Record<string, Record<string, boolean>> = {
  postgresql: { activeDatabase: true, timezone: true, searchPath: true, encoding: true, initCommands: true },
  mysql:      { activeDatabase: true, timezone: true, searchPath: false, encoding: true, initCommands: true },
  mssql:      { activeDatabase: true, timezone: false, searchPath: true, encoding: false, initCommands: true },
  oracle:     { activeDatabase: false, timezone: true, searchPath: true, encoding: true, initCommands: true },
  db2:        { activeDatabase: true, timezone: true, searchPath: true, encoding: false, initCommands: true },
  mongodb:    {},
};

const FIELD_LABELS: Record<string, { label: string; placeholder: string; helperText: string }> = {
  activeDatabase: {
    label: 'Active Database',
    placeholder: 'e.g. mydb',
    helperText: 'Switch the active database for queries',
  },
  timezone: {
    label: 'Timezone',
    placeholder: 'e.g. UTC, America/New_York',
    helperText: 'Session timezone for date/time operations',
  },
  searchPath: {
    label: 'Schema / Search Path',
    placeholder: 'e.g. public, myschema',
    helperText: 'Default schema or search path for unqualified names',
  },
  encoding: {
    label: 'Encoding',
    placeholder: 'e.g. UTF8, latin1',
    helperText: 'Client character encoding',
  },
};

export default function DbSessionConfigPopover({
  open,
  anchorEl,
  onClose,
  protocol,
  sessionId,
  currentConfig,
  onConfigApplied,
}: DbSessionConfigPopoverProps) {
  const [config, setConfig] = useState<DbSessionConfig>({});
  const [initCommandsText, setInitCommandsText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Sync local state when popover opens or currentConfig changes
  useEffect(() => {
    if (open) {
      setConfig({ ...currentConfig });
      setInitCommandsText(currentConfig.initCommands?.join('\n') ?? '');
      setError('');
    }
  }, [open, currentConfig]);

  const fields = FIELD_SUPPORT[protocol] ?? {};

  const handleFieldChange = useCallback((field: keyof DbSessionConfig, value: string) => {
    setConfig((prev) => ({
      ...prev,
      [field]: value || undefined,
    }));
  }, []);

  const handleApply = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError('');

    try {
      const finalConfig: DbSessionConfig = { ...config };
      // Parse initCommands from multiline text
      if (initCommandsText.trim()) {
        finalConfig.initCommands = initCommandsText
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
      } else {
        finalConfig.initCommands = undefined;
      }

      // Remove empty/undefined values
      const cleanConfig: DbSessionConfig = {};
      if (finalConfig.activeDatabase) cleanConfig.activeDatabase = finalConfig.activeDatabase;
      if (finalConfig.timezone) cleanConfig.timezone = finalConfig.timezone;
      if (finalConfig.searchPath) cleanConfig.searchPath = finalConfig.searchPath;
      if (finalConfig.encoding) cleanConfig.encoding = finalConfig.encoding;
      if (finalConfig.initCommands?.length) cleanConfig.initCommands = finalConfig.initCommands;

      const result = await updateDbSessionConfig(sessionId, cleanConfig);
      onConfigApplied(cleanConfig, result.activeDatabase);
    } catch (err) {
      setError(extractApiError(err, 'Failed to apply session config'));
    } finally {
      setLoading(false);
    }
  }, [sessionId, config, initCommandsText, onConfigApplied]);

  const handleReset = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError('');

    try {
      const result = await updateDbSessionConfig(sessionId, {});
      setConfig({});
      setInitCommandsText('');
      onConfigApplied({}, result.activeDatabase);
    } catch (err) {
      setError(extractApiError(err, 'Failed to reset session config'));
    } finally {
      setLoading(false);
    }
  }, [sessionId, onConfigApplied]);

  const hasAnyField = Object.values(fields).some(Boolean);
  const hasChanges = Object.values(config).some((v) => v !== undefined && v !== '') || initCommandsText.trim() !== '';

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{
        paper: {
          sx: { width: 340, maxHeight: 480 },
        },
      }}
    >
      <Box sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          Session Configuration
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          {protocol.toUpperCase()} session parameters
        </Typography>

        {!hasAnyField && (
          <Typography variant="body2" color="text.secondary">
            Session configuration is not available for {protocol.toUpperCase()}.
          </Typography>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {fields.activeDatabase && (
            <Tooltip
              title={protocol === 'postgresql' ? 'Changing database will recreate the connection pool' : ''}
              placement="top"
            >
              <TextField
                size="small"
                fullWidth
                label={FIELD_LABELS.activeDatabase.label}
                placeholder={FIELD_LABELS.activeDatabase.placeholder}
                helperText={
                  protocol === 'postgresql'
                    ? 'Warning: changes require pool recreation'
                    : FIELD_LABELS.activeDatabase.helperText
                }
                value={config.activeDatabase ?? ''}
                onChange={(e) => handleFieldChange('activeDatabase', e.target.value)}
                disabled={loading}
              />
            </Tooltip>
          )}

          {fields.timezone && (
            <TextField
              size="small"
              fullWidth
              label={FIELD_LABELS.timezone.label}
              placeholder={FIELD_LABELS.timezone.placeholder}
              helperText={FIELD_LABELS.timezone.helperText}
              value={config.timezone ?? ''}
              onChange={(e) => handleFieldChange('timezone', e.target.value)}
              disabled={loading}
            />
          )}

          {fields.searchPath && (
            <TextField
              size="small"
              fullWidth
              label={FIELD_LABELS.searchPath.label}
              placeholder={FIELD_LABELS.searchPath.placeholder}
              helperText={FIELD_LABELS.searchPath.helperText}
              value={config.searchPath ?? ''}
              onChange={(e) => handleFieldChange('searchPath', e.target.value)}
              disabled={loading}
            />
          )}

          {fields.encoding && (
            <TextField
              size="small"
              fullWidth
              label={FIELD_LABELS.encoding.label}
              placeholder={FIELD_LABELS.encoding.placeholder}
              helperText={FIELD_LABELS.encoding.helperText}
              value={config.encoding ?? ''}
              onChange={(e) => handleFieldChange('encoding', e.target.value)}
              disabled={loading}
            />
          )}

          {fields.initCommands && (
            <TextField
              size="small"
              fullWidth
              multiline
              minRows={2}
              maxRows={4}
              label="Init Commands"
              placeholder="SET ...\nALTER SESSION SET ..."
              helperText="One SET/ALTER SESSION command per line (OPERATOR+ only)"
              value={initCommandsText}
              onChange={(e) => setInitCommandsText(e.target.value)}
              disabled={loading}
              sx={{ '& .MuiInputBase-root': { fontFamily: 'monospace', fontSize: '0.8rem' } }}
            />
          )}
        </Box>

        {hasAnyField && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
              <Button
                size="small"
                onClick={handleReset}
                disabled={loading || !Object.values(currentConfig).some((v) => v !== undefined)}
              >
                Reset
              </Button>
              <Button
                size="small"
                variant="contained"
                onClick={handleApply}
                disabled={loading || !hasChanges}
                startIcon={loading ? <CircularProgress size={14} /> : undefined}
              >
                Apply
              </Button>
            </Box>
          </>
        )}
      </Box>
    </Popover>
  );
}
