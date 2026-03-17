import {
  Card, CardContent, Typography, Box, ToggleButtonGroup, ToggleButton, useTheme,
} from '@mui/material';
import {
  DarkMode as DarkModeIcon,
  LightMode as LightModeIcon,
  Check as CheckIcon,
} from '@mui/icons-material';
import { useThemeStore } from '../../store/themeStore';
import { themeRegistry, type ThemeName, type ThemeMode } from '../../theme/index';

export default function AppearanceSection() {
  const themeName = useThemeStore((s) => s.themeName);
  const mode = useThemeStore((s) => s.mode);
  const setTheme = useThemeStore((s) => s.setTheme);
  const setMode = useThemeStore((s) => s.setMode);
  const muiTheme = useTheme();

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
          Appearance
        </Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Select a theme and color mode for the interface.
        </Typography>

        {/* Theme grid */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' },
            gap: 2,
            mt: 2,
            mb: 3,
          }}
        >
          {themeRegistry.map((t) => {
            const isSelected = t.name === themeName;
            const swatchColor = mode === 'dark' ? t.accent : t.accentLight;

            return (
              <Box
                key={t.name}
                onClick={() => setTheme(t.name as ThemeName)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setTheme(t.name as ThemeName);
                  }
                }}
                sx={{
                  cursor: 'pointer',
                  border: 2,
                  borderColor: isSelected ? 'primary.main' : 'divider',
                  borderRadius: 2,
                  p: 2,
                  position: 'relative',
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                  '&:hover': {
                    borderColor: isSelected
                      ? 'primary.main'
                      : muiTheme.palette.mode === 'dark'
                        ? 'rgba(255,255,255,0.2)'
                        : 'rgba(0,0,0,0.2)',
                  },
                  ...(isSelected && {
                    boxShadow: `0 0 0 1px ${muiTheme.palette.primary.main}`,
                  }),
                }}
              >
                {isSelected && (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      bgcolor: 'primary.main',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <CheckIcon sx={{ fontSize: 14, color: muiTheme.palette.getContrastText(muiTheme.palette.primary.main) }} />
                  </Box>
                )}

                {/* Accent color swatch */}
                <Box
                  sx={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    bgcolor: swatchColor,
                    mb: 1.5,
                    boxShadow: `0 0 8px ${swatchColor}40`,
                  }}
                />

                <Typography variant="body2" fontWeight={600} noWrap>
                  {t.label}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {t.description}
                </Typography>
              </Box>
            );
          })}
        </Box>

        {/* Mode toggle */}
        <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
          Color mode
        </Typography>
        <ToggleButtonGroup
          value={mode}
          exclusive
          onChange={(_, val) => { if (val) setMode(val as ThemeMode); }}
          size="small"
          sx={{ mt: 0.5 }}
        >
          <ToggleButton value="dark" sx={{ px: 2, gap: 0.5, textTransform: 'none' }}>
            <DarkModeIcon fontSize="small" /> Dark
          </ToggleButton>
          <ToggleButton value="light" sx={{ px: 2, gap: 0.5, textTransform: 'none' }}>
            <LightModeIcon fontSize="small" /> Light
          </ToggleButton>
        </ToggleButtonGroup>
      </CardContent>
    </Card>
  );
}
