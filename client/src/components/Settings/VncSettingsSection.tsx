import {
  Box,
  FormControl,
  FormControlLabel,
  Checkbox,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  Typography,
  Tooltip,
} from '@mui/material';
import { Lock as LockIcon } from '@mui/icons-material';
import type { VncSettings } from '../../constants/vncDefaults';
import { VNC_DEFAULTS, CLIPBOARD_ENCODINGS } from '../../constants/vncDefaults';

function OverrideCheckbox({ label, mode, isOverridden, onToggle, enforced }: {
  label: string;
  mode: 'global' | 'connection';
  isOverridden: boolean;
  onToggle: () => void;
  enforced?: boolean;
}) {
  if (mode !== 'connection') return null;
  return (
    <FormControlLabel
      control={<Checkbox size="small" checked={isOverridden} onChange={onToggle} disabled={enforced} />}
      label={<Typography variant="caption">Override {label}{enforced && <Tooltip title="Enforced by organization policy" arrow><LockIcon sx={{ fontSize: 14, ml: 0.5, color: 'warning.main', verticalAlign: 'middle' }} /></Tooltip>}</Typography>}
      sx={{ mb: 0.5 }}
    />
  );
}

interface VncSettingsSectionProps {
  value: Partial<VncSettings>;
  onChange: (updated: Partial<VncSettings>) => void;
  mode: 'global' | 'connection';
  resolvedDefaults: VncSettings;
  enforcedFields?: Partial<VncSettings>;
}

export default function VncSettingsSection({ value, onChange, mode, resolvedDefaults, enforcedFields }: VncSettingsSectionProps) {
  const effective = { ...resolvedDefaults, ...value };

  const set = (key: keyof VncSettings, val: unknown) => {
    onChange({ ...value, [key]: val });
  };

  const clearKey = (key: keyof VncSettings) => {
    const { [key]: _, ...rest } = value;
    onChange(rest);
  };

  const isConn = mode === 'connection';
  const isEnforced = (key: keyof VncSettings) => enforcedFields !== undefined && enforcedFields[key] !== undefined;
  const fieldDisabled = (key: keyof VncSettings) => isEnforced(key) || (isConn && !(key in value));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Color Depth */}
      <Box>
        <OverrideCheckbox label="Color depth" mode={mode} isOverridden={'colorDepth' in value} onToggle={() => 'colorDepth' in value ? clearKey('colorDepth') : set('colorDepth', 24)} enforced={isEnforced('colorDepth')} />
        <FormControl fullWidth size="small" disabled={fieldDisabled('colorDepth')}>
          <InputLabel>Color Depth</InputLabel>
          <Select value={effective.colorDepth ?? ''} label="Color Depth" onChange={(e) => set('colorDepth', e.target.value || undefined)}>
            <MenuItem value="">Auto</MenuItem>
            <MenuItem value={8}>8-bit (256 colors)</MenuItem>
            <MenuItem value={16}>16-bit (High Color)</MenuItem>
            <MenuItem value={24}>24-bit (True Color)</MenuItem>
            <MenuItem value={32}>32-bit (True Color + Alpha)</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {/* Cursor Mode */}
      <Box>
        <OverrideCheckbox label="Cursor mode" mode={mode} isOverridden={'cursor' in value} onToggle={() => 'cursor' in value ? clearKey('cursor') : set('cursor', VNC_DEFAULTS.cursor)} enforced={isEnforced('cursor')} />
        <FormControl fullWidth size="small" disabled={fieldDisabled('cursor')}>
          <InputLabel>Cursor Mode</InputLabel>
          <Select value={effective.cursor ?? 'local'} label="Cursor Mode" onChange={(e) => set('cursor', e.target.value)}>
            <MenuItem value="local">Local (rendered by browser)</MenuItem>
            <MenuItem value="remote">Remote (rendered by server)</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {/* Clipboard Encoding */}
      <Box>
        <OverrideCheckbox label="Clipboard encoding" mode={mode} isOverridden={'clipboardEncoding' in value} onToggle={() => 'clipboardEncoding' in value ? clearKey('clipboardEncoding') : set('clipboardEncoding', VNC_DEFAULTS.clipboardEncoding)} enforced={isEnforced('clipboardEncoding')} />
        <FormControl fullWidth size="small" disabled={fieldDisabled('clipboardEncoding')}>
          <InputLabel>Clipboard Encoding</InputLabel>
          <Select value={effective.clipboardEncoding ?? 'UTF-8'} label="Clipboard Encoding" onChange={(e) => set('clipboardEncoding', e.target.value)}>
            {CLIPBOARD_ENCODINGS.map((enc) => (
              <MenuItem key={enc.value} value={enc.value}>{enc.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {/* Toggles */}
      <Box>
        <OverrideCheckbox label="Read-only" mode={mode} isOverridden={'readOnly' in value} onToggle={() => 'readOnly' in value ? clearKey('readOnly') : set('readOnly', VNC_DEFAULTS.readOnly)} enforced={isEnforced('readOnly')} />
        <FormControlLabel
          control={<Switch checked={effective.readOnly ?? false} onChange={(e) => set('readOnly', e.target.checked)} disabled={fieldDisabled('readOnly')} />}
          label="Read-only (view only, no input)"
        />
      </Box>

      <Box>
        <OverrideCheckbox label="Swap red/blue" mode={mode} isOverridden={'swapRedBlue' in value} onToggle={() => 'swapRedBlue' in value ? clearKey('swapRedBlue') : set('swapRedBlue', VNC_DEFAULTS.swapRedBlue)} enforced={isEnforced('swapRedBlue')} />
        <FormControlLabel
          control={<Switch checked={effective.swapRedBlue ?? false} onChange={(e) => set('swapRedBlue', e.target.checked)} disabled={fieldDisabled('swapRedBlue')} />}
          label="Swap red/blue channels"
        />
      </Box>

      <Box>
        <OverrideCheckbox label="Disable audio" mode={mode} isOverridden={'disableAudio' in value} onToggle={() => 'disableAudio' in value ? clearKey('disableAudio') : set('disableAudio', VNC_DEFAULTS.disableAudio)} enforced={isEnforced('disableAudio')} />
        <FormControlLabel
          control={<Switch checked={effective.disableAudio ?? true} onChange={(e) => set('disableAudio', e.target.checked)} disabled={fieldDisabled('disableAudio')} />}
          label="Disable audio"
        />
      </Box>
    </Box>
  );
}
