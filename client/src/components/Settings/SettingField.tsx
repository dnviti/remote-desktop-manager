import { useState } from 'react';
import {
  Box, Switch, TextField, Select, MenuItem, FormControlLabel,
  Typography, Chip, Tooltip, IconButton, CircularProgress, InputAdornment,
} from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import SaveIcon from '@mui/icons-material/Save';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import type { SettingValue } from '../../api/systemSettings.api';
import { updateSystemSetting } from '../../api/systemSettings.api';
import { extractApiError } from '../../utils/apiError';

interface Props {
  setting: SettingValue;
  onUpdated: (key: string, value: unknown) => void;
}

function sourceChip(source: 'env' | 'db' | 'default') {
  switch (source) {
    case 'env':
      return <Chip label="ENV" size="small" color="warning" variant="outlined" icon={<LockIcon />} />;
    case 'db':
      return <Chip label="Custom" size="small" color="primary" variant="outlined" />;
    default:
      return <Chip label="Default" size="small" variant="outlined" />;
  }
}

export default function SettingField({ setting, onUpdated }: Props) {
  const [localValue, setLocalValue] = useState<unknown>(setting.value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const dirty = String(localValue) !== String(setting.value);
  const disabled = !setting.canEdit || setting.envLocked || saving;

  const handleSave = async (value: unknown) => {
    setSaving(true);
    setError('');
    try {
      await updateSystemSetting(setting.key, value);
      onUpdated(setting.key, value);
    } catch (err: unknown) {
      setError(extractApiError(err, 'Failed to update setting'));
    } finally {
      setSaving(false);
    }
  };

  const handleBooleanToggle = async () => {
    const newVal = !localValue;
    setLocalValue(newVal);
    await handleSave(newVal);
  };

  if (setting.type === 'boolean') {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.5 }}>
        <Box sx={{ flex: 1, mr: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={Boolean(localValue)}
                  onChange={handleBooleanToggle}
                  disabled={disabled}
                  size="small"
                />
              }
              label={
                <Typography variant="body2" fontWeight="medium">{setting.label}</Typography>
              }
            />
            {sourceChip(setting.source)}
            {setting.restartRequired && (
              <Tooltip title="Requires server restart to take effect">
                <RestartAltIcon fontSize="small" color="action" />
              </Tooltip>
            )}
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ ml: 4.5, display: 'block' }}>
            {setting.description}
          </Typography>
          {error && (
            <Typography variant="caption" color="error" sx={{ ml: 4.5, display: 'block' }}>
              {error}
            </Typography>
          )}
        </Box>
        {saving && <CircularProgress size={16} />}
      </Box>
    );
  }

  if (setting.type === 'select' && setting.options) {
    return (
      <Box sx={{ py: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <Typography variant="body2" fontWeight="medium">{setting.label}</Typography>
          {sourceChip(setting.source)}
          {setting.restartRequired && (
            <Tooltip title="Requires server restart to take effect">
              <RestartAltIcon fontSize="small" color="action" />
            </Tooltip>
          )}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          {setting.description}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Select
            size="small"
            value={String(localValue)}
            onChange={(e) => {
              setLocalValue(e.target.value);
              handleSave(e.target.value);
            }}
            disabled={disabled}
            sx={{ minWidth: 180 }}
          >
            {setting.options.map((opt) => (
              <MenuItem key={opt} value={opt}>
                {opt || '(disabled)'}
              </MenuItem>
            ))}
          </Select>
          {saving && <CircularProgress size={16} />}
        </Box>
        {error && (
          <Typography variant="caption" color="error" sx={{ mt: 0.5, display: 'block' }}>
            {error}
          </Typography>
        )}
      </Box>
    );
  }

  return (
    <Box sx={{ py: 0.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <Typography variant="body2" fontWeight="medium">{setting.label}</Typography>
        {sourceChip(setting.source)}
        {setting.restartRequired && (
          <Tooltip title="Requires server restart to take effect">
            <RestartAltIcon fontSize="small" color="action" />
          </Tooltip>
        )}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        {setting.description}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <TextField
          size="small"
          type={setting.sensitive && !showPassword ? 'password' : setting.type === 'number' ? 'number' : 'text'}
          value={String(localValue ?? '')}
          onChange={(e) => {
            const val = setting.type === 'number' ? Number(e.target.value) : e.target.value;
            setLocalValue(val);
          }}
          disabled={disabled}
          sx={{ minWidth: 220 }}
          slotProps={{
            input: {
              endAdornment: setting.envLocked ? (
                <Tooltip title="Set via environment variable">
                  <LockIcon fontSize="small" color="action" />
                </Tooltip>
              ) : setting.sensitive ? (
                <InputAdornment position="end">
                  <IconButton
                    size="small"
                    onClick={() => setShowPassword(!showPassword)}
                    edge="end"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                  </IconButton>
                </InputAdornment>
              ) : undefined,
            },
          }}
        />
        {dirty && !disabled && (
          <Tooltip title="Save">
            <IconButton
              size="small"
              color="primary"
              onClick={() => handleSave(localValue)}
              disabled={saving}
            >
              {saving ? <CircularProgress size={16} /> : <SaveIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        )}
      </Box>
      {error && (
        <Typography variant="caption" color="error" sx={{ mt: 0.5, display: 'block' }}>
          {error}
        </Typography>
      )}
    </Box>
  );
}
