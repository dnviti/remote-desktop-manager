import { useMemo } from 'react';
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
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  Grid,
  Paper,
  Tooltip,
} from '@mui/material';
import type { SshTerminalConfig, TerminalThemeColors } from '../../constants/terminalThemes';
import { Lock as LockIcon } from '@mui/icons-material';
import {
  FONT_FAMILIES,
  TERMINAL_DEFAULTS,
  THEME_PRESETS,
  THEME_PRESET_NAMES,
} from '../../constants/terminalThemes';
import { useThemeStore } from '../../store/themeStore';

interface TerminalSettingsSectionProps {
  value: Partial<SshTerminalConfig>;
  onChange: (updated: Partial<SshTerminalConfig>) => void;
  mode: 'global' | 'connection';
  resolvedDefaults?: ReturnType<typeof import('../../constants/terminalThemes').mergeTerminalConfig>;
  enforcedFields?: Partial<SshTerminalConfig>;
}

function themeLabel(name: string): string {
  return name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function ColorSwatch({ color, label }: { color: string; label: string }) {
  return (
    <Tooltip title={label} arrow>
      <Box
        sx={{
          width: 18,
          height: 18,
          borderRadius: '3px',
          bgcolor: color,
          border: '1px solid',
          borderColor: 'divider',
          flexShrink: 0,
        }}
      />
    </Tooltip>
  );
}

function ThemePreview({ colors }: { colors: TerminalThemeColors }) {
  return (
    <Box sx={{ display: 'flex', gap: 0.3, flexWrap: 'wrap', mt: 0.5 }}>
      <ColorSwatch color={colors.background} label="bg" />
      <ColorSwatch color={colors.foreground} label="fg" />
      <ColorSwatch color={colors.red} label="red" />
      <ColorSwatch color={colors.green} label="green" />
      <ColorSwatch color={colors.yellow} label="yellow" />
      <ColorSwatch color={colors.blue} label="blue" />
      <ColorSwatch color={colors.magenta} label="magenta" />
      <ColorSwatch color={colors.cyan} label="cyan" />
    </Box>
  );
}

const ANSI_COLOR_KEYS: (keyof TerminalThemeColors)[] = [
  'background', 'foreground', 'cursor', 'selectionBackground',
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
  'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
];

export default function TerminalSettingsSection({
  value,
  onChange,
  mode,
  resolvedDefaults,
  enforcedFields,
}: TerminalSettingsSectionProps) {
  const defaults = resolvedDefaults ?? TERMINAL_DEFAULTS;

  const getVal = <K extends keyof SshTerminalConfig>(key: K): SshTerminalConfig[K] =>
    (value[key] !== undefined ? value[key] : defaults[key as keyof typeof defaults]) as SshTerminalConfig[K];

  const isOverridden = (key: keyof SshTerminalConfig) =>
    mode === 'connection' && value[key] !== undefined;

  const setField = <K extends keyof SshTerminalConfig>(key: K, val: SshTerminalConfig[K]) => {
    onChange({ ...value, [key]: val });
  };

  const clearField = (key: keyof SshTerminalConfig) => {
    const { [key]: _, ...rest } = value;
    onChange(rest);
  };

  const toggleOverride = (key: keyof SshTerminalConfig) => {
    if (isOverridden(key)) {
      clearField(key);
    } else {
      setField(key, defaults[key as keyof typeof defaults] as never);
    }
  };

  const webUiMode = useThemeStore((s) => s.mode);
  const isSyncEnabled = !!(getVal('syncThemeWithWebUI'));

  const currentTheme = useMemo(() => {
    if (isSyncEnabled) {
      const lightTheme = getVal('syncLightTheme') ?? 'solarized-light';
      const darkTheme = getVal('syncDarkTheme') ?? 'default-dark';
      return webUiMode === 'light' ? lightTheme : darkTheme;
    }
    return getVal('theme') ?? 'default-dark';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSyncEnabled, webUiMode, value.syncLightTheme, value.syncDarkTheme, value.theme, defaults]);
  const currentColors: TerminalThemeColors = useMemo(() => {
    if (currentTheme === 'custom') {
      return { ...TERMINAL_DEFAULTS.customColors, ...value.customColors };
    }
    return THEME_PRESETS[currentTheme] ?? THEME_PRESETS['default-dark'];
  }, [currentTheme, value.customColors]);

  const isEnforced = (key: keyof SshTerminalConfig) => enforcedFields !== undefined && enforcedFields[key] !== undefined;

  const renderOverrideCheckbox = (key: keyof SshTerminalConfig) => {
    if (mode !== 'connection') return null;
    const enforced = isEnforced(key);
    return (
      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={isOverridden(key)}
            onChange={() => toggleOverride(key)}
            disabled={enforced}
          />
        }
        label={<>{enforced && <Tooltip title="Enforced by organization policy" arrow><LockIcon sx={{ fontSize: 14, mr: 0.5, color: 'warning.main', verticalAlign: 'middle' }} /></Tooltip>}Override</>}
        sx={{ ml: 0, mr: 1, minWidth: 100 }}
      />
    );
  };

  const isDisabled = (key: keyof SshTerminalConfig) =>
    isEnforced(key) || (mode === 'connection' && !isOverridden(key));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Font Section */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Font</Typography>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              {renderOverrideCheckbox('fontFamily')}
              <FormControl fullWidth size="small" disabled={isDisabled('fontFamily')}>
                <InputLabel>Font Family</InputLabel>
                <Select
                  value={getVal('fontFamily') ?? TERMINAL_DEFAULTS.fontFamily}
                  label="Font Family"
                  onChange={(e) => setField('fontFamily', e.target.value)}
                >
                  {FONT_FAMILIES.map((f) => (
                    <MenuItem key={f.value} value={f.value}>
                      <span style={{ fontFamily: f.value }}>{f.label}</span>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              {renderOverrideCheckbox('fontSize')}
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Font Size: {getVal('fontSize') ?? 14}px
                </Typography>
                <Slider
                  value={getVal('fontSize') ?? 14}
                  min={10}
                  max={24}
                  step={1}
                  disabled={isDisabled('fontSize')}
                  onChange={(_, v) => setField('fontSize', v as number)}
                  valueLabelDisplay="auto"
                  size="small"
                />
              </Box>
            </Box>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              {renderOverrideCheckbox('lineHeight')}
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Line Height: {(getVal('lineHeight') ?? 1.0).toFixed(1)}
                </Typography>
                <Slider
                  value={getVal('lineHeight') ?? 1.0}
                  min={1.0}
                  max={2.0}
                  step={0.1}
                  disabled={isDisabled('lineHeight')}
                  onChange={(_, v) => setField('lineHeight', v as number)}
                  valueLabelDisplay="auto"
                  size="small"
                />
              </Box>
            </Box>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              {renderOverrideCheckbox('letterSpacing')}
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Letter Spacing: {getVal('letterSpacing') ?? 0}px
                </Typography>
                <Slider
                  value={getVal('letterSpacing') ?? 0}
                  min={0}
                  max={5}
                  step={1}
                  disabled={isDisabled('letterSpacing')}
                  onChange={(_, v) => setField('letterSpacing', v as number)}
                  valueLabelDisplay="auto"
                  size="small"
                />
              </Box>
            </Box>
          </Grid>
        </Grid>
      </Box>

      {/* Cursor Section */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Cursor</Typography>
        <Grid container spacing={2} alignItems="center">
          <Grid size={{ xs: 12, sm: 6 }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              {renderOverrideCheckbox('cursorStyle')}
              <Box>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Cursor Style
                </Typography>
                <ToggleButtonGroup
                  value={getVal('cursorStyle') ?? 'block'}
                  exclusive
                  onChange={(_, v) => { if (v) setField('cursorStyle', v); }}
                  size="small"
                  disabled={isDisabled('cursorStyle')}
                >
                  <ToggleButton value="block">Block</ToggleButton>
                  <ToggleButton value="underline">Underline</ToggleButton>
                  <ToggleButton value="bar">Bar</ToggleButton>
                </ToggleButtonGroup>
              </Box>
            </Box>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              {renderOverrideCheckbox('cursorBlink')}
              <FormControlLabel
                control={
                  <Switch
                    checked={getVal('cursorBlink') ?? true}
                    onChange={(e) => setField('cursorBlink', e.target.checked)}
                    disabled={isDisabled('cursorBlink')}
                  />
                }
                label="Cursor Blink"
              />
            </Box>
          </Grid>
        </Grid>
      </Box>

      {/* Theme Sync Section */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Theme Sync</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          {renderOverrideCheckbox('syncThemeWithWebUI')}
          <FormControlLabel
            control={
              <Switch
                checked={isSyncEnabled}
                onChange={(e) => setField('syncThemeWithWebUI', e.target.checked)}
                disabled={isDisabled('syncThemeWithWebUI')}
              />
            }
            label="Sync theme with WebUI light/dark mode"
          />
        </Box>
        {isSyncEnabled && !isDisabled('syncThemeWithWebUI') && (
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                {renderOverrideCheckbox('syncLightTheme')}
                <FormControl fullWidth size="small" disabled={isDisabled('syncLightTheme')}>
                  <InputLabel>Light Mode Theme</InputLabel>
                  <Select
                    value={getVal('syncLightTheme') ?? 'solarized-light'}
                    label="Light Mode Theme"
                    onChange={(e) => setField('syncLightTheme', e.target.value)}
                  >
                    {THEME_PRESET_NAMES.map((name) => (
                      <MenuItem key={name} value={name}>{themeLabel(name)}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                {renderOverrideCheckbox('syncDarkTheme')}
                <FormControl fullWidth size="small" disabled={isDisabled('syncDarkTheme')}>
                  <InputLabel>Dark Mode Theme</InputLabel>
                  <Select
                    value={getVal('syncDarkTheme') ?? 'default-dark'}
                    label="Dark Mode Theme"
                    onChange={(e) => setField('syncDarkTheme', e.target.value)}
                  >
                    {THEME_PRESET_NAMES.map((name) => (
                      <MenuItem key={name} value={name}>{themeLabel(name)}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
            </Grid>
          </Grid>
        )}
        {isSyncEnabled && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            Currently using: {themeLabel(currentTheme)} ({webUiMode} mode)
          </Typography>
        )}
      </Box>

      {/* Theme Section (hidden when sync is enabled) */}
      {!isSyncEnabled && (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Color Theme</Typography>
          {mode === 'connection' && renderOverrideCheckbox('theme')}
          <Grid container spacing={1} sx={{ mb: 1 }}>
            {THEME_PRESET_NAMES.map((name) => (
              <Grid size={{ xs: 6, sm: 4, md: 3 }} key={name}>
                <Paper
                  elevation={currentTheme === name ? 4 : 0}
                  onClick={() => {
                    if (!isDisabled('theme')) {
                      setField('theme', name);
                    }
                  }}
                  sx={{
                    p: 1,
                    cursor: isDisabled('theme') ? 'default' : 'pointer',
                    opacity: isDisabled('theme') ? 0.5 : 1,
                    border: '2px solid',
                    borderColor: currentTheme === name ? 'primary.main' : 'transparent',
                    bgcolor: THEME_PRESETS[name].background,
                    transition: 'border-color 0.2s',
                    '&:hover': !isDisabled('theme') ? { borderColor: 'primary.light' } : {},
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{ color: THEME_PRESETS[name].foreground, fontWeight: 500 }}
                  >
                    {themeLabel(name)}
                  </Typography>
                  <ThemePreview colors={THEME_PRESETS[name]} />
                </Paper>
              </Grid>
            ))}
            {/* Custom option */}
            <Grid size={{ xs: 6, sm: 4, md: 3 }}>
              <Paper
                elevation={currentTheme === 'custom' ? 4 : 0}
                onClick={() => {
                  if (!isDisabled('theme')) {
                    setField('theme', 'custom');
                  }
                }}
                sx={{
                  p: 1,
                  cursor: isDisabled('theme') ? 'default' : 'pointer',
                  opacity: isDisabled('theme') ? 0.5 : 1,
                  border: '2px solid',
                  borderColor: currentTheme === 'custom' ? 'primary.main' : 'transparent',
                  transition: 'border-color 0.2s',
                  '&:hover': !isDisabled('theme') ? { borderColor: 'primary.light' } : {},
                }}
              >
                <Typography variant="caption" sx={{ fontWeight: 500 }}>Custom</Typography>
                <Typography variant="caption" display="block" color="text.secondary">
                  Pick your own colors
                </Typography>
              </Paper>
            </Grid>
          </Grid>

          {/* Custom color pickers */}
          {currentTheme === 'custom' && !isDisabled('theme') && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Custom Colors
              </Typography>
              <Grid container spacing={1}>
                {ANSI_COLOR_KEYS.map((colorKey) => (
                  <Grid size={{ xs: 6, sm: 4, md: 3 }} key={colorKey}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <input
                        type="color"
                        value={currentColors[colorKey]}
                        onChange={(e) => {
                          const newCustom = { ...value.customColors, [colorKey]: e.target.value };
                          onChange({ ...value, customColors: newCustom });
                        }}
                        style={{ width: 28, height: 28, border: 'none', cursor: 'pointer', padding: 0 }}
                      />
                      <Typography variant="caption" noWrap>{colorKey}</Typography>
                    </Box>
                  </Grid>
                ))}
              </Grid>
            </Box>
          )}
        </Box>
      )}

      {/* Performance Section */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Performance</Typography>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              {renderOverrideCheckbox('scrollback')}
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Scrollback: {getVal('scrollback') ?? 1000} lines
                </Typography>
                <Slider
                  value={getVal('scrollback') ?? 1000}
                  min={100}
                  max={10000}
                  step={100}
                  disabled={isDisabled('scrollback')}
                  onChange={(_, v) => setField('scrollback', v as number)}
                  valueLabelDisplay="auto"
                  size="small"
                />
              </Box>
            </Box>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              {renderOverrideCheckbox('bellStyle')}
              <FormControl fullWidth size="small" disabled={isDisabled('bellStyle')}>
                <InputLabel>Bell Style</InputLabel>
                <Select
                  value={getVal('bellStyle') ?? 'none'}
                  label="Bell Style"
                  onChange={(e) => setField('bellStyle', e.target.value as 'none' | 'sound' | 'visual')}
                >
                  <MenuItem value="none">None</MenuItem>
                  <MenuItem value="sound">Sound</MenuItem>
                  <MenuItem value="visual">Visual</MenuItem>
                </Select>
              </FormControl>
            </Box>
          </Grid>
        </Grid>
      </Box>

      {/* Live Preview */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Preview</Typography>
        <Paper
          variant="outlined"
          sx={{
            p: 1.5,
            bgcolor: currentColors.background,
            fontFamily: getVal('fontFamily') ?? TERMINAL_DEFAULTS.fontFamily,
            fontSize: `${getVal('fontSize') ?? 14}px`,
            lineHeight: getVal('lineHeight') ?? 1.0,
            letterSpacing: `${getVal('letterSpacing') ?? 0}px`,
            overflow: 'hidden',
            borderRadius: 1,
          }}
        >
          <Box component="span" sx={{ color: currentColors.green }}>user@host</Box>
          <Box component="span" sx={{ color: currentColors.foreground }}>:</Box>
          <Box component="span" sx={{ color: currentColors.blue }}>~/projects</Box>
          <Box component="span" sx={{ color: currentColors.foreground }}>$ ls -la</Box>
          <br />
          <Box component="span" sx={{ color: currentColors.foreground }}>
            {'total 42'}
          </Box>
          <br />
          <Box component="span" sx={{ color: currentColors.blue }}>drwxr-xr-x</Box>
          <Box component="span" sx={{ color: currentColors.foreground }}> 5 user group 4096 </Box>
          <Box component="span" sx={{ color: currentColors.cyan }}>src/</Box>
          <br />
          <Box component="span" sx={{ color: currentColors.foreground }}>-rw-r--r-- 1 user group 1234 </Box>
          <Box component="span" sx={{ color: currentColors.yellow }}>README.md</Box>
          <br />
          <Box component="span" sx={{ color: currentColors.foreground }}>-rwxr-xr-x 1 user group 5678 </Box>
          <Box component="span" sx={{ color: currentColors.green }}>build.sh</Box>
          <br />
          <Box component="span" sx={{ color: currentColors.red }}>error:</Box>
          <Box component="span" sx={{ color: currentColors.foreground }}> something went wrong</Box>
          <br />
          <Box component="span" sx={{ color: currentColors.magenta }}>warning:</Box>
          <Box component="span" sx={{ color: currentColors.foreground }}> check configuration</Box>
          <br />
          <Box component="span" sx={{ color: currentColors.green }}>user@host</Box>
          <Box component="span" sx={{ color: currentColors.foreground }}>:</Box>
          <Box component="span" sx={{ color: currentColors.blue }}>~/projects</Box>
          <Box component="span" sx={{ color: currentColors.foreground }}>$ </Box>
          <Box
            component="span"
            sx={{
              display: 'inline-block',
              width: '0.6em',
              height: '1.1em',
              bgcolor: currentColors.cursor,
              verticalAlign: 'text-bottom',
              animation: (getVal('cursorBlink') ?? true) ? 'blink 1s step-end infinite' : 'none',
              '@keyframes blink': { '50%': { opacity: 0 } },
            }}
          />
        </Paper>
      </Box>
    </Box>
  );
}
