import {
  Box,
  FormControl,
  FormControlLabel,
  Checkbox,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  Collapse,
} from '@mui/material';
import type { RdpSettings } from '../../constants/rdpDefaults';
import {
  RDP_DEFAULTS,
  QUALITY_PRESETS,
  KEYBOARD_LAYOUTS,
  COMMON_TIMEZONES,
} from '../../constants/rdpDefaults';

function OverrideCheckbox({ label, mode, isOverridden, onToggle }: {
  label: string;
  mode: 'global' | 'connection';
  isOverridden: boolean;
  onToggle: () => void;
}) {
  if (mode !== 'connection') return null;
  return (
    <FormControlLabel
      control={
        <Checkbox
          size="small"
          checked={isOverridden}
          onChange={onToggle}
        />
      }
      label={<Typography variant="caption">Override {label}</Typography>}
      sx={{ mb: 0.5 }}
    />
  );
}

interface RdpSettingsSectionProps {
  value: Partial<RdpSettings>;
  onChange: (updated: Partial<RdpSettings>) => void;
  mode: 'global' | 'connection';
  resolvedDefaults?: RdpSettings;
}

export default function RdpSettingsSection({ value, onChange, mode, resolvedDefaults }: RdpSettingsSectionProps) {
  const defaults = resolvedDefaults ?? RDP_DEFAULTS;

  function get<K extends keyof RdpSettings>(key: K): RdpSettings[K] {
    return value[key] !== undefined ? value[key] : (defaults as RdpSettings)[key];
  }

  function set<K extends keyof RdpSettings>(key: K, val: RdpSettings[K]) {
    onChange({ ...value, [key]: val });
  }

  // In connection mode, track which fields are overridden
  const isOverridden = (key: keyof RdpSettings) => mode === 'connection' && value[key] !== undefined;

  const toggleOverride = (key: keyof RdpSettings, currentVal: unknown) => {
    if (isOverridden(key)) {
      const { [key]: _, ...rest } = value;
      onChange(rest);
    } else {
      onChange({ ...value, [key]: currentVal });
    }
  };

  const fieldDisabled = (key: keyof RdpSettings) => mode === 'connection' && !isOverridden(key);

  const qualityPreset = get('qualityPreset') ?? 'balanced';
  const isCustom = qualityPreset === 'custom';

  const handlePresetChange = (_: unknown, val: string | null) => {
    if (!val) return;
    const next: Partial<RdpSettings> = { ...value, qualityPreset: val as RdpSettings['qualityPreset'] };
    if (val !== 'custom' && QUALITY_PRESETS[val]) {
      Object.assign(next, QUALITY_PRESETS[val]);
    }
    onChange(next);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* ── Quality Preset ─────────────────────────────────────── */}
      <Box>
        <Typography variant="subtitle2" gutterBottom>Quality Preset</Typography>
        <OverrideCheckbox label="quality preset" mode={mode} isOverridden={isOverridden('qualityPreset')} onToggle={() => toggleOverride('qualityPreset', get('qualityPreset'))} />
        <ToggleButtonGroup
          value={qualityPreset}
          exclusive
          onChange={handlePresetChange}
          size="small"
          fullWidth
          disabled={fieldDisabled('qualityPreset')}
        >
          <ToggleButton value="performance">Performance</ToggleButton>
          <ToggleButton value="balanced">Balanced</ToggleButton>
          <ToggleButton value="quality">Quality</ToggleButton>
          <ToggleButton value="custom">Custom</ToggleButton>
        </ToggleButtonGroup>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
          {qualityPreset === 'performance' && 'Minimal bandwidth — no visual effects'}
          {qualityPreset === 'balanced' && 'Theming and font smoothing enabled'}
          {qualityPreset === 'quality' && 'All visual effects enabled'}
          {qualityPreset === 'custom' && 'Fine-tune individual visual effects below'}
        </Typography>
      </Box>

      {/* ── Custom visual effects (only when Custom preset) ──── */}
      <Collapse in={isCustom}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, pl: 1, borderLeft: '2px solid', borderColor: 'divider' }}>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>Visual Effects</Typography>
          {([
            ['enableWallpaper', 'Desktop wallpaper'],
            ['enableTheming', 'Windows theming'],
            ['enableFontSmoothing', 'Font smoothing (ClearType)'],
            ['enableFullWindowDrag', 'Full window drag'],
            ['enableDesktopComposition', 'Desktop composition (Aero)'],
            ['enableMenuAnimations', 'Menu animations'],
            ['forceLossless', 'Force lossless compression'],
          ] as [keyof RdpSettings, string][]).map(([key, label]) => (
            <FormControlLabel
              key={key}
              control={
                <Switch
                  size="small"
                  checked={!!get(key)}
                  onChange={(e) => set(key, e.target.checked as never)}
                  disabled={fieldDisabled(key)}
                />
              }
              label={<Typography variant="body2">{label}</Typography>}
            />
          ))}
        </Box>
      </Collapse>

      {/* ── Display & Resolution ───────────────────────────────── */}
      <Box>
        <Typography variant="subtitle2" gutterBottom>Display & Resolution</Typography>

        <OverrideCheckbox label="color depth" mode={mode} isOverridden={isOverridden('colorDepth')} onToggle={() => toggleOverride('colorDepth', get('colorDepth'))} />
        <FormControl fullWidth size="small" sx={{ mb: 1.5 }} disabled={fieldDisabled('colorDepth')}>
          <InputLabel>Color Depth</InputLabel>
          <Select
            value={get('colorDepth') ?? ''}
            label="Color Depth"
            onChange={(e) => set('colorDepth', (String(e.target.value) === '' ? undefined : Number(e.target.value)) as RdpSettings['colorDepth'])}
          >
            <MenuItem value="">Auto (negotiated)</MenuItem>
            <MenuItem value={8}>8-bit (256 colors)</MenuItem>
            <MenuItem value={16}>16-bit (High Color)</MenuItem>
            <MenuItem value={24}>24-bit (True Color)</MenuItem>
          </Select>
        </FormControl>

        <OverrideCheckbox label="DPI" mode={mode} isOverridden={isOverridden('dpi')} onToggle={() => toggleOverride('dpi', get('dpi'))} />
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="body2" gutterBottom>DPI: {get('dpi') ?? 96}</Typography>
          <Slider
            value={get('dpi') ?? 96}
            onChange={(_, v) => set('dpi', v as number)}
            min={48}
            max={384}
            step={12}
            marks={[
              { value: 96, label: '96' },
              { value: 192, label: '192' },
              { value: 384, label: '384' },
            ]}
            disabled={fieldDisabled('dpi')}
          />
        </Box>

        <OverrideCheckbox label="resolution" mode={mode} isOverridden={isOverridden('width')} onToggle={() => toggleOverride('width', get('width'))} />
        <Box sx={{ display: 'flex', gap: 1, mb: 1.5 }}>
          <TextField
            label="Width"
            type="number"
            size="small"
            value={get('width') ?? ''}
            onChange={(e) => set('width', e.target.value ? Number(e.target.value) : undefined)}
            placeholder="Auto"
            disabled={fieldDisabled('width')}
            slotProps={{ htmlInput: { min: 640, max: 7680 } }}
          />
          <TextField
            label="Height"
            type="number"
            size="small"
            value={get('height') ?? ''}
            onChange={(e) => set('height', e.target.value ? Number(e.target.value) : undefined)}
            placeholder="Auto"
            disabled={fieldDisabled('height')}
            slotProps={{ htmlInput: { min: 480, max: 4320 } }}
          />
        </Box>

        <OverrideCheckbox label="resize method" mode={mode} isOverridden={isOverridden('resizeMethod')} onToggle={() => toggleOverride('resizeMethod', get('resizeMethod'))} />
        <FormControl fullWidth size="small" disabled={fieldDisabled('resizeMethod')}>
          <InputLabel>Resize Method</InputLabel>
          <Select
            value={get('resizeMethod') ?? 'display-update'}
            label="Resize Method"
            onChange={(e) => set('resizeMethod', e.target.value as RdpSettings['resizeMethod'])}
          >
            <MenuItem value="display-update">Display Update (recommended)</MenuItem>
            <MenuItem value="reconnect">Reconnect</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {/* ── Audio ──────────────────────────────────────────────── */}
      <Box>
        <Typography variant="subtitle2" gutterBottom>Audio</Typography>

        <OverrideCheckbox label="audio" mode={mode} isOverridden={isOverridden('disableAudio')} onToggle={() => toggleOverride('disableAudio', get('disableAudio'))} />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={!get('disableAudio')}
              onChange={(e) => set('disableAudio', !e.target.checked)}
              disabled={fieldDisabled('disableAudio')}
            />
          }
          label={<Typography variant="body2">Enable remote audio playback</Typography>}
        />

        <OverrideCheckbox label="microphone" mode={mode} isOverridden={isOverridden('enableAudioInput')} onToggle={() => toggleOverride('enableAudioInput', get('enableAudioInput'))} />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={!!get('enableAudioInput')}
              onChange={(e) => set('enableAudioInput', e.target.checked)}
              disabled={fieldDisabled('enableAudioInput')}
            />
          }
          label={<Typography variant="body2">Enable microphone input</Typography>}
        />
      </Box>

      {/* ── Security ───────────────────────────────────────────── */}
      <Box>
        <Typography variant="subtitle2" gutterBottom>Security</Typography>

        <OverrideCheckbox label="security type" mode={mode} isOverridden={isOverridden('security')} onToggle={() => toggleOverride('security', get('security'))} />
        <FormControl fullWidth size="small" sx={{ mb: 1.5 }} disabled={fieldDisabled('security')}>
          <InputLabel>Security Type</InputLabel>
          <Select
            value={get('security') ?? 'nla'}
            label="Security Type"
            onChange={(e) => set('security', e.target.value as RdpSettings['security'])}
          >
            <MenuItem value="any">Any (auto-negotiate)</MenuItem>
            <MenuItem value="nla">NLA (Network Level Auth)</MenuItem>
            <MenuItem value="nla-ext">NLA Extended</MenuItem>
            <MenuItem value="tls">TLS</MenuItem>
            <MenuItem value="rdp">RDP (legacy)</MenuItem>
          </Select>
        </FormControl>

        <OverrideCheckbox label="certificate" mode={mode} isOverridden={isOverridden('ignoreCert')} onToggle={() => toggleOverride('ignoreCert', get('ignoreCert'))} />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={get('ignoreCert') ?? false}
              onChange={(e) => set('ignoreCert', e.target.checked)}
              disabled={fieldDisabled('ignoreCert')}
            />
          }
          label={<Typography variant="body2">Ignore server certificate errors</Typography>}
        />
      </Box>

      {/* ── Session ────────────────────────────────────────────── */}
      <Box>
        <Typography variant="subtitle2" gutterBottom>Session</Typography>

        <OverrideCheckbox label="keyboard layout" mode={mode} isOverridden={isOverridden('serverLayout')} onToggle={() => toggleOverride('serverLayout', get('serverLayout'))} />
        <FormControl fullWidth size="small" sx={{ mb: 1.5 }} disabled={fieldDisabled('serverLayout')}>
          <InputLabel>Keyboard Layout</InputLabel>
          <Select
            value={get('serverLayout') ?? ''}
            label="Keyboard Layout"
            onChange={(e) => set('serverLayout', e.target.value || undefined)}
          >
            <MenuItem value="">Default (en-us-qwerty)</MenuItem>
            {KEYBOARD_LAYOUTS.map((kl) => (
              <MenuItem key={kl.value} value={kl.value}>{kl.label}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <OverrideCheckbox label="timezone" mode={mode} isOverridden={isOverridden('timezone')} onToggle={() => toggleOverride('timezone', get('timezone'))} />
        <FormControl fullWidth size="small" sx={{ mb: 1.5 }} disabled={fieldDisabled('timezone')}>
          <InputLabel>Timezone</InputLabel>
          <Select
            value={get('timezone') ?? ''}
            label="Timezone"
            onChange={(e) => set('timezone', e.target.value || undefined)}
          >
            <MenuItem value="">Not set (server default)</MenuItem>
            {COMMON_TIMEZONES.map((tz) => (
              <MenuItem key={tz} value={tz}>{tz}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <OverrideCheckbox label="console session" mode={mode} isOverridden={isOverridden('console')} onToggle={() => toggleOverride('console', get('console'))} />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={!!get('console')}
              onChange={(e) => set('console', e.target.checked)}
              disabled={fieldDisabled('console')}
            />
          }
          label={<Typography variant="body2">Console / admin session</Typography>}
        />
      </Box>
    </Box>
  );
}
